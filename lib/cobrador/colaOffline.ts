// ─────────────────────────────────────────────────────────────────────────
//  Cola OFFLINE del cobrador (localStorage). Permite registrar cobros/no-pagos
//  sin señal: se encolan con la HORA REAL del dispositivo y el GPS, y se
//  sincronizan al recuperar conexión. Sin dependencias; store externo simple.
//
//  Semántica: exactly-once. Cada op lleva un `id` (uuid) que viaja como `op_id`
//  al insert; el índice único de 0006 evita duplicar si un flush se corta
//  después de insertar (el reintento se trata como éxito idempotente).
// ─────────────────────────────────────────────────────────────────────────

export type OpTipo = "pago" | "no_pago";

export interface OpCobro {
  /** Id generado en el dispositivo; viaja como op_id para el dedupe (0006). */
  id: string;
  tipo: OpTipo;
  clienteId: string;
  clienteNombre: string;
  /** Crédito al que se imputa (si el cliente tiene varios activos). null = el
   *  principal. Opcional para retro-compatibilidad con ops ya encoladas. */
  prestamoId?: string | null;
  monto: number | null; // pago: monto o null (=cuota). no_pago: null
  motivo: string | null; // no_pago: id del motivo
  gpsLat: number | null;
  gpsLng: number | null;
  /** Hora real del cobro (Date.now() al registrar). */
  deviceTs: number;
  intentos: number;
  /** No sincronizar antes de este instante (epoch ms). Da la ventana de
   *  "Deshacer" y el margen para que el GPS asíncrono se adjunte antes de
   *  enviar. undefined = enviar apenas haya señal (comportamiento clásico). */
  holdHasta?: number;
}

const KEY = "py_cola_cobros";
const subs = new Set<() => void>();
let cache: OpCobro[] = [];
// Ids de ops cuyo `guardar` NO logró persistir (cuota / Safari privado): viven
// SOLO en memoria. `leer` las RESCATA para que un re-leer (p. ej. el `parchearGps`
// asíncrono ~1 s después del cobro) no las borre de memoria antes de que el flush
// las mande → sin esto, el cobro no persistido se perdía igual, en silencio. Se
// limpian solas al persistir o al removerse (`guardar` reconstruye el set).
const soloEnMemoria = new Set<string>();

function disponible(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Parseo PURO de la cola desde storage, con CUARENTENA ante JSON corrupto:
 *  nunca descartar en silencio (el crudo se copia a una clave aparte, recuperable)
 *  y recién ahí se resetea la clave viva a "[]" para no volver a fallar en cada
 *  lectura ni que el próximo `guardar` pise el crudo. NO fusiona ni toca `cache`. */
function leerStorage(): OpCobro[] {
  if (!disponible()) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) throw new Error("cola corrupta: no es un arreglo");
    return parsed as OpCobro[];
  } catch {
    try {
      if (raw) window.localStorage.setItem(`${KEY}_corrupta_${Date.now()}`, raw);
      window.localStorage.setItem(KEY, "[]");
    } catch {
      /* storage no escribible: no hay más que preservar; seguimos en memoria */
    }
    return [];
  }
}

/** Lectura CON fusión: storage es la verdad durable, PERO nunca se pierde una op
 *  que vive solo en memoria (su `guardar` no persistió). Unión por id — un reenvío
 *  eventual es idempotente (op_id + índice único 0006), así que rescatar de más es
 *  seguro y perder un cobro no. */
function leer(): OpCobro[] {
  if (!disponible()) return cache; // sin storage: manda el cache en memoria
  const deStorage = leerStorage();
  const idsStorage = new Set(deStorage.map((o) => o.id));
  const rescatar = cache.filter((o) => !idsStorage.has(o.id) && soloEnMemoria.has(o.id));
  cache = rescatar.length > 0 ? [...deStorage, ...rescatar] : deStorage;
  return cache;
}

/** Persiste la cola. Devuelve si REALMENTE quedó en disco (sobrevive recarga):
 *  false si el storage la rechaza (cuota llena / Safari privado con quota 0) o no
 *  está disponible. El llamador que AGREGA un cobro debe avisar al cobrador cuando
 *  da false: en memoria alcanza para reintentar en la sesión, pero NO sobrevive
 *  cerrar la app → sin aviso, un cobro se perdería en silencio. */
function guardar(ops: OpCobro[]): boolean {
  cache = ops;
  let persistido = false;
  if (disponible()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ops));
      persistido = true;
    } catch {
      persistido = false; // cuota llena / Safari privado: NO sobrevive recarga
    }
  }
  // Marca de "memoria-only": si NO persistió, toda la cola actual vive solo en
  // memoria (que `leer` la rescate); si persistió, ya es durable. `guardar` siempre
  // reescribe TODO el set, así que reconstruirlo entero es correcto (las ops
  // removidas dejan de estar marcadas y no resucitan).
  soloEnMemoria.clear();
  if (!persistido) for (const o of ops) soloEnMemoria.add(o.id);
  for (const cb of subs) cb();
  return persistido;
}

const nuevoId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Op ya encolada + si quedó PERSISTIDA en disco (`persistido=false` ⇒ solo en
 *  memoria: avisar al cobrador y reintentar; no sobrevive cerrar la app). */
export type OpEncolada = OpCobro & { persistido: boolean };

/** Encola una operación de cobro/no-pago. Devuelve la op creada + `persistido`.
 *  `holdMs` retiene la op ese tiempo antes de sincronizar (ventana de Deshacer
 *  + margen para adjuntar el GPS asíncrono). */
export function encolar(
  op: Omit<OpCobro, "id" | "intentos" | "deviceTs" | "holdHasta"> & { deviceTs?: number },
  opts?: { holdMs?: number },
): OpEncolada {
  const deviceTs = op.deviceTs ?? Date.now();
  const completa: OpCobro = {
    ...op,
    id: nuevoId(),
    intentos: 0,
    deviceTs,
    holdHasta: opts?.holdMs != null ? deviceTs + opts.holdMs : undefined,
  };
  const persistido = guardar([...leer(), completa]);
  return { ...completa, persistido };
}

/** Adjunta el GPS a una op ya encolada (llega asíncrono, no bloquea el registro).
 *  Si no hubo lectura (ambos null) no toca nada: se conserva lo que tenga. */
export function parchearGps(id: string, lat: number | null, lng: number | null): void {
  if (lat == null && lng == null) return;
  guardar(leer().map((o) => (o.id === id ? { ...o, gpsLat: lat, gpsLng: lng } : o)));
}

export function quitar(id: string): void {
  guardar(leer().filter((o) => o.id !== id));
}

export function marcarIntento(id: string): void {
  guardar(leer().map((o) => (o.id === id ? { ...o, intentos: o.intentos + 1 } : o)));
}

// ── Confirmación con gracia ────────────────────────────────────────────────
//  Cuando una op se sincroniza OK se saca de la cola, pero avisamos a los
//  suscriptores (con la op) para que la UI optimista (p. ej. el cartón) la siga
//  mostrando unos segundos hasta que el refresco del servidor la refleje. Así
//  no hay parpadeo "pagado → pendiente → pagado" en el traspaso.
type ConfirmadoCb = (op: OpCobro) => void;
const confSubs = new Set<ConfirmadoCb>();

export function suscribirConfirmado(cb: ConfirmadoCb): () => void {
  confSubs.add(cb);
  return () => {
    confSubs.delete(cb);
  };
}

/** Saca la op de la cola por ÉXITO de sync (no por Deshacer) y avisa la gracia. */
export function confirmar(id: string): void {
  const cola = leer();
  const op = cola.find((o) => o.id === id);
  guardar(cola.filter((o) => o.id !== id));
  if (op) for (const cb of confSubs) cb(op);
}

/** Snapshot estable para useSyncExternalStore. */
export function pendientes(): OpCobro[] {
  return cache;
}

/** Lee de localStorage y refresca el cache (llamar al montar). Fusiona (vía `leer`),
 *  así que si ya hay ops memoria-only en la sesión, un re-montaje (p. ej. abrir
 *  "Cerrar jornada") NO las descarta. */
export function hidratar(): OpCobro[] {
  return leer();
}

/** SOLO para tests: descarta TODO el estado en memoria (cache + marcas). NO-OP
 *  fuera de `test` — es un footgun money-critical (vaciaría la cola viva), así que
 *  se blinda para que ni siquiera una llamada accidental en prod borre datos. */
export function _resetParaTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  cache = [];
  soloEnMemoria.clear();
}

export function suscribir(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

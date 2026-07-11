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

function disponible(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function leer(): OpCobro[] {
  if (!disponible()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as OpCobro[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function guardar(ops: OpCobro[]): void {
  cache = ops;
  if (disponible()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ops));
    } catch {
      /* cuota llena: se ignora */
    }
  }
  for (const cb of subs) cb();
}

const nuevoId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Encola una operación de cobro/no-pago. Devuelve la op creada.
 *  `holdMs` retiene la op ese tiempo antes de sincronizar (ventana de Deshacer
 *  + margen para adjuntar el GPS asíncrono). */
export function encolar(
  op: Omit<OpCobro, "id" | "intentos" | "deviceTs" | "holdHasta"> & { deviceTs?: number },
  opts?: { holdMs?: number },
): OpCobro {
  const deviceTs = op.deviceTs ?? Date.now();
  const completa: OpCobro = {
    ...op,
    id: nuevoId(),
    intentos: 0,
    deviceTs,
    holdHasta: opts?.holdMs != null ? deviceTs + opts.holdMs : undefined,
  };
  guardar([...leer(), completa]);
  return completa;
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

/** Lee de localStorage y refresca el cache (llamar una vez al montar). */
export function hidratar(): OpCobro[] {
  return leer();
}

export function suscribir(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

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
  monto: number | null; // pago: monto o null (=cuota). no_pago: null
  motivo: string | null; // no_pago: id del motivo
  gpsLat: number | null;
  gpsLng: number | null;
  /** Hora real del cobro (Date.now() al registrar). */
  deviceTs: number;
  intentos: number;
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

/** Encola una operación de cobro/no-pago. Devuelve la op creada. */
export function encolar(
  op: Omit<OpCobro, "id" | "intentos" | "deviceTs"> & { deviceTs?: number },
): OpCobro {
  const completa: OpCobro = {
    ...op,
    id: nuevoId(),
    intentos: 0,
    deviceTs: op.deviceTs ?? Date.now(),
  };
  guardar([...leer(), completa]);
  return completa;
}

export function quitar(id: string): void {
  guardar(leer().filter((o) => o.id !== id));
}

export function marcarIntento(id: string): void {
  guardar(leer().map((o) => (o.id === id ? { ...o, intentos: o.intentos + 1 } : o)));
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

// ─────────────────────────────────────────────────────────────────────────
//  ¿La cola offline BLOQUEA el cierre de jornada? La regla, extraída de
//  CerrarJornada (sesión de caos 15-08: vivía inline en el componente, sin
//  ningún test — y es la que impide rendir un faltante fantasma).
//
//  · Cobros SINCRONIZANDO (se reintentan solos) → BLOQUEAN: si se rinde con
//    ellos abajo, el esperado del server no los ve y el acta sella un faltante
//    que no existe.
//  · Cobros ATASCADOS (agotaron los reintentos: error permanente) → NO
//    bloquean, pero aparecen para descartar/re-registrar — nunca desaparecen
//    en silencio.
//  · Los "no pagó" atascados también se listan (la franja naranja los cuenta;
//    esconderlos dejaba el aviso encendido para siempre sin salida).
// ─────────────────────────────────────────────────────────────────────────
import { opAtascada } from "@/lib/cobrador/colaOffline";

export interface OpParaCierre {
  tipo: string;
  clienteId: string;
  monto?: number | null;
  intentos?: number;
}

export interface VeredictoCierre<T extends OpParaCierre> {
  /** true → el botón de rendir se apaga hasta que la cola suba. */
  bloquea: boolean;
  /** Cobros que van a subir solos (los que bloquean). */
  cobrosPend: T[];
  /** Ops con error permanente (cobros Y visitas): a resolver a mano, no bloquean. */
  atascados: T[];
  /** Plata de los cobros pendientes (para decirle al cobrador cuánto falta subir). */
  montoPend: number;
  /** Un cliente de la cola trabada, para colgar la nota de aviso en su ficha. */
  clienteDeLaCola: string | null;
}

export function bloqueoCierrePorCola<T extends OpParaCierre>(ops: T[]): VeredictoCierre<T> {
  const cobrosPend = ops.filter((o) => o.tipo === "pago" && !opAtascada(o));
  const atascados = ops.filter((o) => opAtascada(o));
  return {
    bloquea: cobrosPend.length > 0,
    cobrosPend,
    atascados,
    montoPend: cobrosPend.reduce((s, o) => s + (o.monto ?? 0), 0),
    clienteDeLaCola: cobrosPend[0]?.clienteId ?? null,
  };
}

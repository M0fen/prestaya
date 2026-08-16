// ─────────────────────────────────────────────────────────────────────────
//  EL CORAZÓN del drenaje de la cola offline — extraído de useSync para que
//  tenga tests (sesión 15-08: era la única pieza P1 del acta sin harness).
//
//  Todas las decisiones de plata del drenaje viven acá, con las dependencias
//  INYECTADAS (las Server Actions y la cola llegan por parámetro): el hook
//  useSync queda como cáscara de timers/estado/eventos, y esta función se
//  ejercita en vitest con dobles — cada rama, incluida la que protege cobros
//  reales durante un freeze y la que evita que una op envenenada bloquee el
//  cierre para siempre.
//
//  El CONTRATO (cada regla nació de un incidente real):
//   · HOLD respetado: una op retenida (ventana de Deshacer/GPS) no se envía;
//     se informa cuándo vence la más próxima para reprogramar el flush.
//   · ATASCADAS afuera: agotaron reintentos — dejan de spamear al server.
//   · Éxito o DUPLICADO → confirmar (el duplicado no es plata perdida: el
//     primer cobro YA está en el libro; dejarlo haría que el cierre pidiera
//     "registralo de nuevo").
//   · Temporal SISTÉMICO (kill switch / sesión / red caída) → CORTA el batch
//     sin acumular intentos: un freeze no marca cobros reales como atascados.
//   · Temporal AMBIGUO → NO corta (anti head-of-line) y acumula intento SOLO
//     si el pase no tuvo freno sistémico: la op envenenada solitaria llega a
//     MAX_INTENTOS y cae a atascada en vez de reintentar para siempre.
//   · PERMANENTE → atascada YA, guardando el mensaje del server (está escrito
//     para el cobrador con la plata en la mano).
//   · PARES LEGÍTIMOS: dos cobros reales del mismo monto a >10 min (horas del
//     DISPOSITIVO) llevan el bypass del candado — al drenar al día siguiente
//     el sellado colapsa las horas y sin esto el 2º moría como "duplicado".
// ─────────────────────────────────────────────────────────────────────────
import type { OpCobro } from "@/lib/cobrador/colaOffline";
import { esParteDeParSeparado } from "@/lib/candadoCobro";
import type { MotivoNoPago } from "@/app/cobrador/(app)/motivos";

export interface ResultadoAccion {
  ok: boolean;
  retryable?: boolean;
  sistemico?: boolean;
  duplicado?: boolean;
  error?: string;
}

export interface DepsDrenaje {
  registrarPago(input: {
    clienteId: string;
    prestamoId: string | null;
    monto?: number | null;
    adelanto: boolean;
    gpsLat?: number | null;
    gpsLng?: number | null;
    gpsPrecision?: number | null;
    registradoEn: string;
    opId: string;
  }): Promise<ResultadoAccion>;
  registrarNoPago(input: {
    clienteId: string;
    prestamoId: string | null;
    motivo: MotivoNoPago;
    gpsLat?: number | null;
    gpsLng?: number | null;
    gpsPrecision?: number | null;
    registradoEn: string;
    opId: string;
  }): Promise<ResultadoAccion>;
  confirmar(id: string): void;
  marcarAtascada(id: string, motivo: string | null): void;
  marcarIntento(id: string): void;
  opAtascada(op: OpCobro): boolean;
  /** Estampa adelanto=true EN LA COLA: la decisión "es un par legítimo"
   *  sobrevive a la pasada (si el 2º del par falla transitorio y reintenta
   *  SOLO, sin esto perdía el bypass y moría como "duplicado"). */
  persistirAdelanto(id: string): void;
  ahora(): number;
}

export interface VeredictoDrenaje {
  /** Algo subió: la vista tiene que refrescarse. */
  algunoOk: boolean;
  /** Corte inequívoco (kill switch / sesión / red): reintentar TODO más tarde. */
  frenoSistemico: boolean;
  /** Cantidad de ambiguas del pase (informativo). */
  ambiguas: number;
  /** ms hasta que venza la op retenida más próxima (para reprogramar), o null. */
  proximoHoldMs: number | null;
  /** Hay que programar un reintento (hubo freno o ambiguas). */
  reintentar: boolean;
}

export async function drenarCola(cola: OpCobro[], deps: DepsDrenaje): Promise<VeredictoDrenaje> {
  const ahora = deps.ahora();
  // Ventana de "Deshacer"/GPS: no enviar las aún retenidas. Atascadas afuera.
  const listas = cola.filter((o) => (!o.holdHasta || o.holdHasta <= ahora) && !deps.opAtascada(o));
  const enEspera = cola.filter((o) => o.holdHasta && o.holdHasta > ahora);
  const proximoHoldMs =
    enEspera.length > 0
      ? Math.max(250, Math.min(...enEspera.map((o) => o.holdHasta as number)) - ahora)
      : null;

  let algunoOk = false;
  let frenoSistemico = false;
  const ambiguas: OpCobro[] = [];

  for (const op of listas) {
    const registradoEn = new Date(op.deviceTs).toISOString();
    // Par legítimo: se decide contra TODA la cola (una op retenida por hold o
    // atascada sigue contando como par) y se PERSISTE antes de enviar — si esta
    // pasada se corta a mitad del par, la siguiente conserva la decisión.
    const esPar = !(op.adelanto ?? false) && op.tipo === "pago" && esParteDeParSeparado(op, cola);
    if (esPar) deps.persistirAdelanto(op.id);
    try {
      const res =
        op.tipo === "pago"
          ? await deps.registrarPago({
              clienteId: op.clienteId,
              prestamoId: op.prestamoId ?? null,
              monto: op.monto,
              adelanto: (op.adelanto ?? false) || esPar,
              gpsLat: op.gpsLat,
              gpsLng: op.gpsLng,
              gpsPrecision: op.gpsPrecision ?? null,
              registradoEn,
              opId: op.id,
            })
          : await deps.registrarNoPago({
              clienteId: op.clienteId,
              prestamoId: op.prestamoId ?? null,
              motivo: (op.motivo ?? "no_estaba") as MotivoNoPago,
              gpsLat: op.gpsLat,
              gpsLng: op.gpsLng,
              gpsPrecision: op.gpsPrecision ?? null,
              registradoEn,
              opId: op.id,
            });
      if (res.ok) {
        deps.confirmar(op.id);
        algunoOk = true;
      } else if (res.retryable && res.sistemico) {
        frenoSistemico = true;
        break;
      } else if (res.retryable) {
        ambiguas.push(op);
      } else if (res.duplicado) {
        deps.confirmar(op.id);
        algunoOk = true;
      } else {
        deps.marcarAtascada(op.id, res.error ?? null);
      }
    } catch {
      // La propia llamada tiró (fetch failed): red caída = señal sistémica.
      frenoSistemico = true;
      break;
    }
  }

  // Escalar ambiguas SOLO si el server respondió a cada op (sin freno): la
  // envenenada acumula hasta MAX_INTENTOS y cae a atascada; durante un corte
  // de red NO se marca ningún cobro real.
  if (!frenoSistemico) for (const op of ambiguas) deps.marcarIntento(op.id);

  return {
    algunoOk,
    frenoSistemico,
    ambiguas: ambiguas.length,
    proximoHoldMs,
    reintentar: frenoSistemico || ambiguas.length > 0,
  };
}

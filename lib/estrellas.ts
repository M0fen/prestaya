// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — SISTEMA DE ESTRELLAS. Núcleo PURO (sin React, sin IO).
//  Es dinero-adyacente: el saldo de estrellas se canjea por beneficios reales,
//  así que la fuente de verdad debe ser a prueba de errores.
//
//  Regla de negocio (de Mauricio):
//   · Cada PAGO vigente = 1 fragmento de estrella.
//   · 5 fragmentos = 1 estrella completa.
//   · Se acumulan SIN tope.
//   · Al redimir: máximo 5 estrellas POR CICLO (ciclo = mes calendario UY).
//   · La redención la aprueba el admin (el cliente solicita → queda pendiente).
//
//  DISEÑO A PRUEBA DE "ESTRELLAS FANTASMA": los fragmentos NO se guardan; se
//  DERIVAN del conteo de pagos NO anulados. Si un pago se anula, el fragmento
//  desaparece solo (nunca hay saldo inflado por un pago revertido). Lo único que
//  se persiste son las REDENCIONES (tabla inmutable con estado + auditoría).
// ─────────────────────────────────────────────────────────────────────────

export const FRAGMENTOS_POR_ESTRELLA = 5;
/** Tope de estrellas que se pueden redimir por ciclo (mes calendario). */
export const TOPE_REDENCION_CICLO = 5;

export type EstadoRedencion = "pendiente" | "aprobada" | "rechazada";

/** Modo de ciclo del tope de canje (lo define el admin). */
export type ModoCicloEstrellas = "mes" | "credito";

/**
 * Clave del ciclo actual para el tope de canje. Con "mes" usa el mes calendario
 * ("2026-07"); con "credito" usa el préstamo activo ("cred:<id>"), así el cupo se
 * reinicia con cada crédito nuevo. Si no hay préstamo, cae al mes. PURA.
 */
export function claveCiclo(
  modo: ModoCicloEstrellas,
  opts: { cicloMes: string; prestamoId: string | null },
): string {
  return modo === "credito" && opts.prestamoId ? `cred:${opts.prestamoId}` : opts.cicloMes;
}

/** Una redención (lo mínimo que el núcleo necesita). */
export interface RedencionMin {
  estrellas: number;
  estado: EstadoRedencion;
  /** Ciclo en que se solicitó, "YYYY-MM". */
  ciclo: string;
}

export interface EntradaEstrellas {
  /** Cantidad de pagos NO anulados del cliente (1 pago = 1 fragmento). */
  pagosVigentes: number;
  /** Redenciones del cliente (cualquier estado). */
  redenciones: RedencionMin[];
  /** Ciclo actual "YYYY-MM" para aplicar el tope por ciclo. */
  cicloActual: string;
}

export interface SaldoEstrellas {
  /** Fragmentos ganados en total (= pagos vigentes). */
  fragmentos: number;
  /** Estrellas completas ganadas (floor(fragmentos / 5)). */
  estrellasGanadas: number;
  /** Estrellas ya redimidas (redenciones APROBADAS). */
  estrellasRedimidas: number;
  /** Estrellas solicitadas sin resolver (reservadas, no se pueden re-pedir). */
  estrellasPendientes: number;
  /** Estrellas libres para redimir ahora (ganadas − redimidas − pendientes). */
  disponibles: number;
  /** Progreso hacia la próxima estrella: 0..4 fragmentos. */
  progresoFragmento: number;
  /** Fragmentos que faltan para completar la próxima estrella (1..5). */
  faltanParaEstrella: number;
  /** Cuántas estrellas puede pedir AHORA, respetando el tope del ciclo. */
  redimiblesCiclo: number;
}

/** Suma las estrellas de las redenciones que cumplen un predicado. */
function sumar(redenciones: RedencionMin[], pred: (r: RedencionMin) => boolean): number {
  return redenciones.reduce((acc, r) => (pred(r) ? acc + Math.max(0, Math.round(r.estrellas)) : acc), 0);
}

/**
 * Calcula el saldo de estrellas de un cliente a partir de sus pagos vigentes y
 * sus redenciones. Función PURA y determinista.
 */
export function calcularEstrellas(e: EntradaEstrellas): SaldoEstrellas {
  const fragmentos = Math.max(0, Math.floor(e.pagosVigentes));
  const estrellasGanadas = Math.floor(fragmentos / FRAGMENTOS_POR_ESTRELLA);

  const estrellasRedimidas = sumar(e.redenciones, (r) => r.estado === "aprobada");
  const estrellasPendientes = sumar(e.redenciones, (r) => r.estado === "pendiente");

  // Las pendientes reservan saldo: no se pueden volver a pedir hasta resolverse.
  const disponibles = Math.max(0, estrellasGanadas - estrellasRedimidas - estrellasPendientes);

  const progresoFragmento = fragmentos % FRAGMENTOS_POR_ESTRELLA;
  const faltanParaEstrella = FRAGMENTOS_POR_ESTRELLA - progresoFragmento;

  // Tope por ciclo: cuentan las aprobadas + pendientes del ciclo actual
  // (las rechazadas no consumen cupo).
  const usadasEnCiclo = sumar(
    e.redenciones,
    (r) => r.ciclo === e.cicloActual && r.estado !== "rechazada",
  );
  const cupoCiclo = Math.max(0, TOPE_REDENCION_CICLO - usadasEnCiclo);
  const redimiblesCiclo = Math.min(disponibles, cupoCiclo);

  return {
    fragmentos,
    estrellasGanadas,
    estrellasRedimidas,
    estrellasPendientes,
    disponibles,
    progresoFragmento,
    faltanParaEstrella,
    redimiblesCiclo,
  };
}

/**
 * Valida una SOLICITUD de redención de `cantidad` estrellas contra el saldo.
 * Devuelve ok o el motivo del rechazo. Se usa en el servidor antes de insertar.
 */
export function validarRedencion(
  saldo: SaldoEstrellas,
  cantidad: number,
): { ok: true } | { ok: false; error: string } {
  const n = Math.round(cantidad);
  if (!(n > 0)) return { ok: false, error: "Elegí cuántas estrellas querés canjear." };
  if (n > TOPE_REDENCION_CICLO)
    return { ok: false, error: `Podés canjear hasta ${TOPE_REDENCION_CICLO} estrellas por mes.` };
  if (n > saldo.disponibles) return { ok: false, error: "No tenés esa cantidad disponible." };
  if (n > saldo.redimiblesCiclo)
    return { ok: false, error: `Este mes ya llegaste al tope de ${TOPE_REDENCION_CICLO}.` };
  return { ok: true };
}

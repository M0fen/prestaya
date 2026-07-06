// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — LÍNEA DE COMPORTAMIENTO (caritas). Núcleo PURO (sin React, sin
//  IO). Reemplaza a la mascota: deriva del CARTÓN (estados por día) una lectura
//  emocional del avance del crédito, para que el cliente la entienda de un
//  vistazo. NO inventa otra fuente de verdad: consume los mismos estados
//  (pagado/pendiente/atrasado/futuro) que ya calcula lib/cartones.ts.
//
//  Tono amable (ver SKILL): en la vista de cliente el "rojo" es SUAVE (#E06A6A)
//  y los mensajes no reprochan. La carita roja es de "te esperamos", no de reto.
// ─────────────────────────────────────────────────────────────────────────
import type { EstadoDia } from "@/types/cartones";

export type NivelComportamiento = "verde" | "naranja" | "roja";

/** Lo mínimo que necesita el núcleo de cada día (subconjunto de DiaCarton). */
export interface DiaMinimo {
  dia: number;
  estado: EstadoDia;
  esHoy: boolean;
}

export interface CaritaDia {
  dia: number;
  estado: EstadoDia;
  carita: string;
  color: string;
}

export interface ComportamientoGeneral {
  nivel: NivelComportamiento;
  carita: string;
  color: string;
  titulo: string;
  mensaje: string;
  atrasados: number;
  pendientes: number;
}

/**
 * Umbral (días atrasados) para pasar de NARANJA a ROJA. Con menos, el atraso se
 * considera leve (naranja). Ajustable (una sola perilla).
 */
export const UMBRAL_ROJA = 3;

// Colores por nivel. Rojo SUAVE en la vista de cliente (sin alarma; ver SKILL).
const COLOR: Record<NivelComportamiento, string> = {
  verde: "#1FA971",
  naranja: "#E8A317",
  roja: "#E06A6A",
};

// Carita general por nivel: feliz / neutral / enojada (elección de Mauricio).
// Ojo: la CARA es expresiva, pero el color sigue SUAVE y el MENSAJE amable
// (sin reproche): la vista de cliente no usa lenguaje de culpa (ver SKILL).
const CARITA_NIVEL: Record<NivelComportamiento, string> = {
  verde: "😄",
  naranja: "😐",
  roja: "😠",
};

// Carita por día según su estado (para la línea del tiempo).
const CARITA_ESTADO: Record<EstadoDia, string> = {
  pagado: "😄",
  pendiente: "😐",
  atrasado: "😠",
  futuro: "⚪",
};

const COLOR_ESTADO: Record<EstadoDia, string> = {
  pagado: "#1FA971",
  pendiente: "#E8A317",
  atrasado: "#E06A6A",
  futuro: "#DCE3F4",
};

/**
 * Nivel general del crédito a partir de los estados de sus días:
 *   · roja    → atraso serio (≥ UMBRAL_ROJA días vencidos sin pago)
 *   · naranja → algún pendiente o atraso leve (1..UMBRAL_ROJA−1 días)
 *   · verde   → al día (sin atrasados ni pendientes)
 */
export function comportamientoGeneral(
  dias: DiaMinimo[],
  umbralRoja: number = UMBRAL_ROJA,
): ComportamientoGeneral {
  const atrasados = dias.filter((d) => d.estado === "atrasado").length;
  const pendientes = dias.filter((d) => d.estado === "pendiente").length;

  let nivel: NivelComportamiento;
  if (atrasados >= umbralRoja) nivel = "roja";
  else if (atrasados > 0 || pendientes > 0) nivel = "naranja";
  else nivel = "verde";

  const TEXTO: Record<NivelComportamiento, { titulo: string; mensaje: string }> = {
    verde: {
      titulo: "¡Vas al día!",
      mensaje: "Tus pagos están al día. Seguí así, vas excelente. 💚",
    },
    naranja: {
      titulo: "Casi al día",
      mensaje: "Te queda algo por completar. ¡Lo resolvés enseguida! 💛",
    },
    roja: {
      titulo: "Te esperamos",
      mensaje: "Hace unos días que no registramos un pago. Cuando puedas, seguimos juntos. 💙",
    },
  };

  return {
    nivel,
    carita: CARITA_NIVEL[nivel],
    color: COLOR[nivel],
    titulo: TEXTO[nivel].titulo,
    mensaje: TEXTO[nivel].mensaje,
    atrasados,
    pendientes,
  };
}

/** Carita + color de un día según su estado. */
export function caritaDeDia(d: DiaMinimo): CaritaDia {
  return {
    dia: d.dia,
    estado: d.estado,
    carita: CARITA_ESTADO[d.estado],
    color: COLOR_ESTADO[d.estado],
  };
}

/**
 * Línea del tiempo: las últimas `n` cuotas YA TRANSCURRIDAS (excluye futuras),
 * cada una con su carita. Se lee de izquierda (más vieja) a derecha (hoy).
 */
export function caritasUltimas(dias: DiaMinimo[], n = 8): CaritaDia[] {
  const transcurridos = dias.filter((d) => d.estado !== "futuro");
  return transcurridos.slice(-n).map(caritaDeDia);
}

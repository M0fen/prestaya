// ─────────────────────────────────────────────────────────────────────────
//  Capa de JUEGO de la vista del cliente (AUGMENTA la vista actual, no la
//  reemplaza). Deriva nivel / XP / racha / logros del cartón REAL (pagos), con
//  tono amable: es un acompañamiento positivo, no un casino. Puro y testeable.
// ─────────────────────────────────────────────────────────────────────────
import type { Pago, Prestamo } from "@/types/db";
import { calcularEstadosCarton } from "./cartones";

export interface NivelJuego {
  nombre: string;
  umbral: number;
  color: string;
  etapa: number; // etapa de crecimiento del nivel (0→4)
}

export const NIVELES: NivelJuego[] = [
  { nombre: "Bronce", umbral: 0, color: "#B06A3A", etapa: 0 },
  { nombre: "Plata", umbral: 500, color: "#8A94A6", etapa: 1 },
  { nombre: "Oro", umbral: 1000, color: "#CBA14A", etapa: 2 },
  { nombre: "Platino", umbral: 1600, color: "#3A9D8F", etapa: 3 },
  { nombre: "Diamante", umbral: 2400, color: "#4F6BD8", etapa: 4 },
];

export type EstadoRachaJuego = "al_dia" | "en_riesgo" | "rota";

export interface LogroJuego {
  id: string;
  nombre: string;
  emoji: string;
  desbloqueado: boolean;
}

/** Misión con progreso (juego liviano derivado del comportamiento de pago). */
export interface MisionJuego {
  id: string;
  titulo: string;
  detalle: string;
  emoji: string;
  progreso: number; // 0..1
  completa: boolean;
}

export interface JuegoCliente {
  nivel: NivelJuego;
  nivelSiguiente: NivelJuego | null;
  xp: number;
  xpEnNivel: number;
  xpParaSubir: number;
  progresoNivel: number; // 0..1
  racha: number;
  mejorRacha: number;
  estadoRacha: EstadoRachaJuego;
  escudos: number;
  boletos: number;
  cuotasPagadas: number;
  totalDias: number;
  cuotasParaSubir: number;
  logros: LogroJuego[];
  misiones: MisionJuego[];
  completo: boolean;
}

export interface OpcionesJuego {
  /** Meta de racha para la misión principal (configurable por el admin). */
  metaRacha?: number;
}

const XP_PAGO = 50;
const BONUS_RACHA = 5; // cada 5 de racha

function nivelPorXp(xp: number): { actual: NivelJuego; siguiente: NivelJuego | null } {
  let actual = NIVELES[0];
  for (const n of NIVELES) if (xp >= n.umbral) actual = n;
  const idx = NIVELES.indexOf(actual);
  return { actual, siguiente: NIVELES[idx + 1] ?? null };
}

type PrestamoCalc = Pick<Prestamo, "cuota_diaria" | "total_dias" | "fecha_inicio">;
type PagoCalc = Pick<Pago, "dia_credito" | "monto">;

/** Deriva el estado de juego del cliente a partir de su préstamo y pagos. */
export function calcularJuegoCliente(
  prestamo: PrestamoCalc,
  pagos: PagoCalc[],
  hoy: Date,
  opciones: OpcionesJuego = {},
): JuegoCliente {
  const r = calcularEstadosCarton(prestamo, pagos, hoy);

  const cuotasPagadas = r.dias.filter((d) => d.estado === "pagado").length;
  const atrasados = r.dias.filter((d) => d.estado === "atrasado").length;

  // Racha actual: corrida de días pagados que termina hoy. El día de HOY aún
  // sin pagar NO rompe la racha previa (la cuota recién vence al cierre).
  let racha = 0;
  for (const d of r.dias) {
    if (d.estado === "futuro") break;
    if (d.esHoy && d.estado !== "pagado") break;
    if (d.estado === "pagado") racha++;
    else racha = 0;
  }

  const estadoRacha: EstadoRachaJuego =
    atrasados === 0 ? "al_dia" : racha > 0 ? "en_riesgo" : "rota";
  const escudos = Math.min(2, Math.floor(r.mejorRacha / 8));

  const xp = cuotasPagadas * XP_PAGO + Math.floor(r.mejorRacha / 5) * BONUS_RACHA;
  const { actual, siguiente } = nivelPorXp(xp);
  const xpEnNivel = xp - actual.umbral;
  const xpParaSubir = siguiente ? siguiente.umbral - actual.umbral : 0;
  const progresoNivel = xpParaSubir > 0 ? clamp01(xpEnNivel / xpParaSubir) : 1;
  const cuotasParaSubir = siguiente
    ? Math.max(1, Math.ceil((siguiente.umbral - xp) / XP_PAGO))
    : 0;

  const completo = r.falta === 0;

  const logros: LogroJuego[] = [
    { id: "primera", nombre: "Primera cuota", emoji: "🌱", desbloqueado: cuotasPagadas >= 1 },
    { id: "racha5", nombre: "Racha de 5", emoji: "🔥", desbloqueado: r.mejorRacha >= 5 },
    { id: "racha10", nombre: "Racha de 10", emoji: "⚡", desbloqueado: r.mejorRacha >= 10 },
    { id: "mitad", nombre: "Mitad del camino", emoji: "🏔️", desbloqueado: r.progresoPct >= 50 },
    { id: "oro", nombre: "Nivel Oro", emoji: "👑", desbloqueado: xp >= 1000 },
  ];

  // ── Misiones (juegos livianos con progreso, derivados de los pagos) ────────
  const metaRacha = Math.max(1, Math.round(opciones.metaRacha ?? 10));
  const exigibles = r.dias.filter((d) => d.estado !== "futuro");
  const ult7 = exigibles.slice(-7);
  const pagados7 = ult7.filter((d) => d.estado === "pagado").length;

  const misiones: MisionJuego[] = [
    {
      id: "racha_meta",
      titulo: `Racha de ${metaRacha}`,
      detalle: `${Math.min(r.mejorRacha, metaRacha)}/${metaRacha} días al hilo`,
      emoji: "🔥",
      progreso: clamp01(r.mejorRacha / metaRacha),
      completa: r.mejorRacha >= metaRacha,
    },
    {
      id: "semana",
      titulo: "Semana al día",
      detalle: `${pagados7}/7 días cubiertos`,
      emoji: "🗓️",
      progreso: clamp01(pagados7 / 7),
      completa: pagados7 >= 7,
    },
    {
      id: "completo",
      titulo: "Crédito al 100%",
      detalle: `${r.progresoPct}% pagado`,
      emoji: "🏁",
      progreso: clamp01(r.progresoPct / 100),
      completa: r.falta === 0,
    },
  ];

  return {
    nivel: actual,
    nivelSiguiente: siguiente,
    mejorRacha: r.mejorRacha,
    xp,
    xpEnNivel,
    xpParaSubir,
    progresoNivel,
    racha,
    estadoRacha,
    escudos,
    boletos: cuotasPagadas,
    cuotasPagadas,
    totalDias: prestamo.total_dias,
    cuotasParaSubir,
    logros,
    misiones,
    completo,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

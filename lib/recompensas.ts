// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO de RECOMPENSAS. Client-safe y testeable. Evalúa cada premio que
//  el admin definió contra el estado REAL del juego del cliente (derivado de sus
//  pagos): desbloqueada / en progreso / bloqueada, con su barra. No se trucan:
//  todo sale de calcularJuegoCliente.
// ─────────────────────────────────────────────────────────────────────────
import type { JuegoCliente } from "./juegoCliente";

export type HitoTipo = "racha" | "mes_al_dia" | "credito_completo" | "nivel";

export interface Recompensa {
  id: string;
  titulo: string;
  premio: string;
  hitoTipo: HitoTipo;
  hitoValor: number;
}

export type EstadoRecompensa = "desbloqueada" | "en_progreso" | "bloqueada";

export interface RecompensaEvaluada extends Recompensa {
  estado: EstadoRecompensa;
  progreso: number; // 0..1
  detalle: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function evaluarUna(r: Recompensa, j: JuegoCliente): RecompensaEvaluada {
  let progreso = 0;
  let cumple = false;
  let detalle = "";

  switch (r.hitoTipo) {
    case "racha": {
      const meta = Math.max(1, r.hitoValor);
      progreso = clamp01(j.mejorRacha / meta);
      cumple = j.mejorRacha >= meta;
      detalle = `${Math.min(j.mejorRacha, meta)}/${meta} días al hilo`;
      break;
    }
    case "mes_al_dia": {
      const alDia = j.estadoRacha === "al_dia";
      cumple = alDia;
      progreso = alDia ? 1 : j.racha > 0 ? 0.5 : 0;
      detalle = alDia ? "Vas al día" : "Poné el crédito al día";
      break;
    }
    case "credito_completo": {
      progreso = j.totalDias > 0 ? clamp01(j.cuotasPagadas / j.totalDias) : 0;
      cumple = j.completo;
      detalle = `${j.cuotasPagadas}/${j.totalDias} cuotas`;
      break;
    }
    case "nivel": {
      const meta = Math.max(0, r.hitoValor);
      cumple = j.nivel.etapa >= meta;
      progreso = cumple ? 1 : clamp01(j.nivel.etapa / Math.max(1, meta)) * 0.7 + j.progresoNivel * 0.3;
      detalle = cumple ? `Nivel ${j.nivel.nombre}` : `Subí de nivel`;
      break;
    }
  }

  const estado: EstadoRecompensa = cumple ? "desbloqueada" : progreso > 0 ? "en_progreso" : "bloqueada";
  return { ...r, estado, progreso, detalle };
}

/** Evalúa todas las recompensas contra el estado del juego (mantiene el orden). */
export function evaluarRecompensas(recompensas: Recompensa[], juego: JuegoCliente): RecompensaEvaluada[] {
  return recompensas.map((r) => evaluarUna(r, juego));
}

/** Cuántas recompensas tiene desbloqueadas (para un resumen rápido). */
export function contarDesbloqueadas(evaluadas: RecompensaEvaluada[]): number {
  return evaluadas.filter((r) => r.estado === "desbloqueada").length;
}

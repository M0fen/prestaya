// ─────────────────────────────────────────────────────────────────────────
//  Ajustes de la ZONA DE JUEGO (control del admin). Puro/client-safe: el tipo y
//  los valores por defecto se usan igual en el servidor, en la vista del
//  cliente y en el panel. La lectura/escritura en la base vive en
//  lib/data/juegoConfig.ts. Ver migración 0009.
// ─────────────────────────────────────────────────────────────────────────
import { JUEGOS, JUEGO_ACTUAL, type Juego } from "./juegos";

export interface AjustesJuego {
  /** Interruptor maestro de toda la zona de juego (misiones, recompensas, arcade). */
  activo: boolean;
  /** Id del juego arcade del mes (clave de JUEGOS). */
  juegoActivo: string;
  /** Meta de racha para la misión principal. */
  metaRacha: number;
  /** Texto del premio al lograr la meta de racha. */
  premioMeta: string;
  /** Mensaje de aliento arriba de la zona de juego. */
  mensajeBienvenida: string;
  /** Mostrar las misiones (barras de progreso). */
  mostrarMisiones: boolean;
  /** Temporada/evento del mes encendido. */
  temporadaActiva: boolean;
  /** Nombre del evento, p. ej. "Mundial 2026". */
  temporadaNombre: string;
  /** Emoji del evento. */
  temporadaEmoji: string;
  /** Meta colectiva (% de la cartera al día). */
  temporadaMeta: number;
  /** Premio si el equipo/cartera llega a la meta colectiva. */
  temporadaPremio: string;
  /** Ciclo del tope de canje de estrellas: por mes o por crédito (0022). */
  estrellasCiclo: "mes" | "credito";
  /** Días de atraso para que la carita pase de naranja a roja (0022). */
  umbralCaritas: number;
}

export const AJUSTES_JUEGO_DEFAULT: AjustesJuego = {
  activo: true,
  juegoActivo: JUEGO_ACTUAL.id,
  metaRacha: 10,
  premioMeta: "Mejor tasa en tu próximo crédito",
  mensajeBienvenida: "Cada pago te acerca a tu meta. ¡Seguí así! 🌱",
  mostrarMisiones: true,
  temporadaActiva: false,
  temporadaNombre: "",
  temporadaEmoji: "🏆",
  temporadaMeta: 90,
  temporadaPremio: "",
  estrellasCiclo: "mes",
  umbralCaritas: 3,
};

/** Devuelve el juego arcade elegido (o el del mes si el id no existe). */
export function juegoArcadeDe(ajustes: AjustesJuego): Juego {
  return JUEGOS[ajustes.juegoActivo] ?? JUEGO_ACTUAL;
}

// Tipo compartido entre la capa de datos (server) y los componentes de la lista
// de equipo (client). Vive aparte de lib/data/equipo.ts para que el "server-only"
// de esa capa NO entre al bundle del navegador.
import type { Rol } from "./db";

export interface MiembroEquipo {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  esDev: boolean;
  telefono: string | null;
  documento: string | null;
  refDisapp: string | null;
  ruta: string | null;
  email: string | null;
  ultimoAccesoIso: string | null;
  /** Login dentro de las últimas ~24 h (proxy honesto, etiquetado como tal). */
  conectado: boolean;
  dispositivos: number;
  creadoEnIso: string;

  // ── Estado REAL de HOY (lo que sirve para operar) ──────────────────────
  /** Última navegación de hoy en la app (tabla eventos_uso). null = no abrió. */
  ultimaVistaIso: string | null;
  /** Cobros NATIVOS registrados hoy por la persona y su monto (custodia). */
  cobrosHoy: number;
  recaudadoHoy: number;
  /** Clientes activos en su ruta (0 = cuenta sin cartera). */
  cartera: number;
  /** Base de caja que se le entregó hoy. null = todavía no se le cargó. */
  baseHoy: number | null;
  /** true si ya cerró/rindió la caja de hoy. */
  rindio: boolean;
  /** Puso su propia contraseña (onboarding día 1). null = sigue con la de arranque. */
  claveCambiadaEn: string | null;
}

/** Cómo viene la persona HOY. Deriva de las señales reales, no del login. */
export type EstadoDia = "cobrando" | "abierta" | "sin_entrar" | "sin_ruta" | "baja";

export function estadoDelDia(m: MiembroEquipo): EstadoDia {
  if (!m.activo) return "baja";
  if (m.cobrosHoy > 0) return "cobrando";
  if (m.ultimaVistaIso) return "abierta";
  if (m.rol === "cobrador" && m.cartera === 0) return "sin_ruta";
  return "sin_entrar";
}

export const ETIQUETA_ESTADO_DIA: Record<EstadoDia, { txt: string; bg: string; fg: string }> = {
  cobrando: { txt: "Cobrando", bg: "#E4F5EC", fg: "#157A50" },
  abierta: { txt: "Abrió la app", bg: "#EAF0FF", fg: "#1E47C8" },
  sin_entrar: { txt: "No entró hoy", bg: "#FDF3E2", fg: "#9A6A0E" },
  sin_ruta: { txt: "Sin ruta", bg: "#F1F3F9", fg: "#8A93AD" },
  baja: { txt: "De baja", bg: "#F1F3F9", fg: "#8A93AD" },
};

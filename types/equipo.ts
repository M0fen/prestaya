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
}

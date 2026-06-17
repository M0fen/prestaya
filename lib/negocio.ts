// ─────────────────────────────────────────────────────────────────────────
//  Datos del negocio prestamista — configuración FIJA del proyecto.
//  Hay un único prestamista (Mauricio), así que estos datos no viven en la
//  base de datos. Si en el futuro hubiera varias oficinas, se migra a tabla.
// ─────────────────────────────────────────────────────────────────────────
import type { Negocio } from "@/types/cartones";

export const NEGOCIO: Negocio = {
  nombre: "Presta Ya",
  direccion: "Av. 18 de Julio 1456, Montevideo",
  telefono: "2402 1830",
  horario: "Lunes a sábado, 8:00 a 18:00 h",
};

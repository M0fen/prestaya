// ─────────────────────────────────────────────────────────────────────────
//  Datos del negocio prestamista — por VARIABLE DE ENTORNO (08-05).
//  Antes había una dirección y un teléfono de EJEMPLO hardcodeados ("Av. 18 de
//  Julio 1456", "2402 1830"): el botón de ayuda del login terminaba marcando
//  un número que no era de nadie. Regla: dato real por env, o NADA — la UI
//  esconde lo que no está configurado, jamás muestra un dato inventado.
//
//  En Vercel (Production):
//    NEXT_PUBLIC_NEGOCIO_TELEFONO   → teléfono real de la oficina
//    NEXT_PUBLIC_NEGOCIO_DIRECCION  → dirección real (si se quiere mostrar)
//    NEXT_PUBLIC_NEGOCIO_HORARIO    → horario (tiene default razonable)
// ─────────────────────────────────────────────────────────────────────────
import type { Negocio } from "@/types/cartones";

export const NEGOCIO: Negocio = {
  nombre: process.env.NEXT_PUBLIC_NEGOCIO_NOMBRE || "Presta Ya",
  direccion: process.env.NEXT_PUBLIC_NEGOCIO_DIRECCION || "",
  telefono: process.env.NEXT_PUBLIC_NEGOCIO_TELEFONO || "",
  horario: process.env.NEXT_PUBLIC_NEGOCIO_HORARIO || "Lunes a sábado, 8:00 a 18:00 h",
};

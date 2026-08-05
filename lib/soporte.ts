// ─────────────────────────────────────────────────────────────────────────
//  SOPORTE — a quién escribe el equipo si algo no anda (sobre todo, si un
//  cobrador no puede entrar y el chat interno no le sirve).
//
//  El WhatsApp de soporte se configura por variable (NEXT_PUBLIC_SOPORTE_WHATSAPP,
//  ej. el de Mauricio o la oficina). Si no está, se cae al teléfono de la oficina
//  (NEGOCIO.telefono) como enlace `tel:`. Así el botón SIEMPRE lleva a algún lado.
//  Público (NEXT_PUBLIC_) porque se usa también en la pantalla de login.
// ─────────────────────────────────────────────────────────────────────────
import { NEGOCIO } from "@/lib/negocio";
import { telWhatsApp } from "@/lib/telefono";

/** WhatsApp de soporte (solo dígitos, con país). "" si no se configuró. */
export const SOPORTE_WHATSAPP = telWhatsApp(process.env.NEXT_PUBLIC_SOPORTE_WHATSAPP);

/** Teléfono visible de respaldo (oficina). */
export const SOPORTE_TEL = NEGOCIO.telefono;

export interface EnlaceSoporte {
  href: string;
  /** true si es WhatsApp (chat), false si es una llamada (tel:). */
  esWhatsApp: boolean;
}

/** Mejor enlace de soporte disponible: WhatsApp si está configurado, si no `tel:`
 *  al teléfono real de la oficina. `null` si NO hay ningún canal configurado —
 *  la UI esconde el botón (antes caía a un teléfono de ejemplo hardcodeado y el
 *  botón de ayuda marcaba un número que no era de nadie). */
export function enlaceSoporte(texto?: string): EnlaceSoporte | null {
  if (SOPORTE_WHATSAPP) {
    const msg = texto ? `?text=${encodeURIComponent(texto)}` : "";
    return { href: `https://wa.me/${SOPORTE_WHATSAPP}${msg}`, esWhatsApp: true };
  }
  if (SOPORTE_TEL) return { href: `tel:${SOPORTE_TEL.replace(/\s/g, "")}`, esWhatsApp: false };
  return null;
}

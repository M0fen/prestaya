// ─────────────────────────────────────────────────────────────────────────
//  ESTADO de una publicación (anuncio al cliente, banner al equipo).
//  Núcleo PURO: dado {activo, desde, hasta} y "ahora", dice si está EN PANTALLA,
//  PROGRAMADO (a futuro), VENCIDO o PAUSADO. Es la MISMA regla de vigencia que
//  usa el cliente/cobrador para ver (o no) la pieza → así el admin ve en la
//  lista exactamente lo que está en pantalla, no un "activo" que miente.
// ─────────────────────────────────────────────────────────────────────────

export type EstadoPublicacion = "en_pantalla" | "programado" | "vencido" | "pausado";

/** ms de una fecha ISO, o null si es vacía/ilegible (no filtra por fecha inválida). */
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Estado de vigencia de una publicación.
 *  · !activo                    → "pausado"
 *  · activo y desde en el futuro → "programado"
 *  · activo y hasta ya pasó      → "vencido"
 *  · en otro caso               → "en_pantalla"
 * El apagado manual (pausado) MANDA sobre las fechas: si lo apagaste, no importa
 * la ventana. `desde`/`hasta` son opcionales (un banner sin ventana nunca vence).
 */
export function estadoPublicacion(
  p: { activo: boolean; desde?: string | null; hasta?: string | null },
  ahora: Date = new Date(),
): EstadoPublicacion {
  if (!p.activo) return "pausado";
  const t = ahora.getTime();
  const desde = ms(p.desde);
  if (desde != null && desde > t) return "programado";
  const hasta = ms(p.hasta);
  if (hasta != null && hasta < t) return "vencido";
  return "en_pantalla";
}

/** Etiqueta + colores de cada estado (para el badge; una sola fuente de verdad). */
export const META_ESTADO: Record<EstadoPublicacion, { label: string; bg: string; fg: string }> = {
  en_pantalla: { label: "En pantalla", bg: "#E4F5EC", fg: "#157A50" },
  programado: { label: "Programado", bg: "#EAF0FF", fg: "#1E47C8" },
  vencido: { label: "Vencido", bg: "#FBE9E7", fg: "#B23B3B" },
  pausado: { label: "Pausado", bg: "#F1F3F9", fg: "#6B7494" },
};

// ─────────────────────────────────────────────────────────────────────────
//  FOTOS DE LA TIENDA, OPTIMIZADAS — la palanca de velocidad #1 (15-08).
//
//  Las fotos de producto viven en el Storage público de Supabase como PNG de
//  700–850 KB, y se servían CRUDAS en cada tarjeta: en LTE la grilla quedaba
//  con cajas EN BLANCO varios segundos (las capturas de prod lo muestran).
//  Supabase Pro trae transformación on-the-fly: el mismo objeto por
//  `render/image` con width+quality sale como WebP de ~20 KB — medido real:
//  la TV de 758 KB bajó a 19,7 KB a 480px (40×).
//
//  Solo se transforman las URLs de NUESTRO storage; cualquier otra pasa tal
//  cual (no romper fotos externas). El zoom pide ancho grande; las miniaturas,
//  chico — el CDN cachea cada variante.
// ─────────────────────────────────────────────────────────────────────────

const MARCA_STORAGE = "/storage/v1/object/public/";
const MARCA_RENDER = "/storage/v1/render/image/public/";

/** Anchos estándar (que el CDN cachee POCAS variantes, no una por píxel). */
export const FOTO = {
  /** Miniaturas de galería, ítems de carrito, chips de categoría. */
  mini: 128,
  /** Tarjeta de producto en grilla/carrusel. */
  tarjeta: 480,
  /** Foto principal de la ficha / hero. */
  ficha: 800,
  /** Zoom a pantalla completa. */
  zoom: 1600,
} as const;

export function fotoTienda(
  url: string | null | undefined,
  ancho: number,
  calidad = 75,
): string | null {
  if (!url) return null;
  const i = url.indexOf(MARCA_STORAGE);
  if (i < 0) return url; // externa o ya transformada: tal cual
  const base = url.slice(0, i) + MARCA_RENDER + url.slice(i + MARCA_STORAGE.length);
  // La URL original no lleva query (verificado contra el catálogo vivo); si
  // alguna lo trajera, no la rompemos: no transformamos.
  if (base.includes("?")) return url;
  return `${base}?width=${Math.round(ancho)}&quality=${Math.round(calidad)}`;
}

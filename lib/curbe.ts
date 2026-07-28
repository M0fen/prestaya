// ─────────────────────────────────────────────────────────────────────────
//  CURBE — la publicidad de curbe.uy se siembra por script (scripts/seed-curbe.mjs)
//  con IDs FIJOS (upsert idempotente). Por eso, si el admin la BORRA desde el
//  panel, "reaparece" al re-sembrar y confunde ("la borré y volvió").
//
//  Estos IDs permiten al panel RECONOCER esos dos registros para: (a) marcarlos
//  como publicidad gestionada por fuera, y (b) avisar antes de borrarlos
//  (mejor pausarlos). Deben coincidir con los del seed.
// ─────────────────────────────────────────────────────────────────────────

/** Anuncio de curbe en el carrusel del cliente. */
export const CURBE_ANUNCIO_ID = "c0b0e000-0000-4000-8000-000000000001";
/** Banner/oferta de curbe en la app del cobrador. */
export const CURBE_BANNER_ID = "c0b0e000-0000-4000-8000-000000000002";

/** ¿Este id es uno de los avisos de curbe gestionados por script? */
export function esAvisoCurbe(id: string | null | undefined): boolean {
  return id === CURBE_ANUNCIO_ID || id === CURBE_BANNER_ID;
}

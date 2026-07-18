// ─────────────────────────────────────────────────────────────────────────
//  Geo-cerca (geofencing) para el control anti-fuga del cobrador.
//  Un cobro se marca "en zona" si el GPS del teléfono está a menos de RADIO
//  metros de la casa del cliente. Detecta cobros fuera del domicilio.
//  Solo aplica si el cliente tiene ubicación guardada (clientes.gps_lat/lng).
// ─────────────────────────────────────────────────────────────────────────

export const RADIO_ZONA_M = 120;

export interface Punto {
  lat: number;
  lng: number;
}

/** Distancia entre dos coordenadas (metros), fórmula de Haversine. */
export function distanciaMetros(a: Punto, b: Punto): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** ¿Es una coordenada válida? OJO: 0 es válido (ecuador/Greenwich). No usar
 *  `!coord`, porque `!0 === true` descartaría el 0 como si faltara el dato. */
const esCoord = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v);

/**
 * Evalúa la geo-cerca. Devuelve null si falta algún dato (no se puede evaluar).
 *
 * `enZona` es de TRES estados: `true` (en zona), `false` (fuera), o `null` cuando
 * la PRECISIÓN del fix del cobro (accuracy en metros) es tan mala que el punto real
 * podría caer del otro lado del borde → no se afirma nada. Así un cobrador honesto
 * con señal pobre no recibe un falso "fuera de zona" (que alimenta score/alertas
 * anti-fuga), y tampoco se da un falso "en zona" a uno lejano. Sin `precision` (fix
 * viejo sin el dato) se evalúa como antes.
 */
export function evaluarZona(
  cobro: { lat: number | null; lng: number | null; precision?: number | null } | null,
  casa: { lat: number | null; lng: number | null } | null,
  radio = RADIO_ZONA_M,
): { enZona: boolean | null; metros: number } | null {
  if (!cobro || !casa) return null;
  if (!esCoord(cobro.lat) || !esCoord(cobro.lng) || !esCoord(casa.lat) || !esCoord(casa.lng))
    return null;
  const metros = distanciaMetros(
    { lat: cobro.lat, lng: cobro.lng },
    { lat: casa.lat, lng: casa.lng },
  );
  // Incertidumbre por precisión: `margen` es la distancia del cobro al anillo del
  // radio; si la accuracy la supera, el verdadero punto podría estar del otro lado
  // → indeterminado. (Refinamiento futuro: sumar también la precisión de la casa.)
  const precision = cobro.precision;
  if (precision != null && Number.isFinite(precision) && precision > Math.abs(metros - radio)) {
    return { enZona: null, metros };
  }
  return { enZona: metros <= radio, metros };
}

// ─────────────────────────────────────────────────────────────────────────
//  ¿Esta op de la cola offline es un COBRO DE HOY de este cliente?
//
//  El filtro por día es obligatorio y tiene que ser EL MISMO en todas las
//  superficies: una op ATASCADA de AYER que siga en la cola pintaba "Cobrado ✓"
//  en el atajo (que filtraba bien), pero la casilla ⟳ del cartón de la ficha
//  no filtraba por día — y la ficha comparaba con `toDateString()`, que solo
//  coincide con el corte UY (03:00Z) si el teléfono está en zona horaria
//  uruguaya. Tres criterios a metros de distancia = tres comportamientos para
//  el mismo cobro. Desde la sesión de caos (15-08) los tres importan esto.
// ─────────────────────────────────────────────────────────────────────────
import { fechaISOUY } from "@/lib/fecha";

export interface OpDeCola {
  tipo: string;
  clienteId: string;
  prestamoId?: string | null;
  deviceTs: number;
}

/** ¿Op de PAGO de HOY (día uruguayo, corte 03:00Z) de este cliente? El match de
 *  crédito lo decide cada superficie (el atajo exige el crédito exacto; el
 *  cartón acepta prestamoId null porque el cobro de un toque no lo trae). */
export function esPagoDeHoy(
  o: OpDeCola,
  clienteId: string,
  ahora: Date = new Date(),
): boolean {
  return (
    o.tipo === "pago" &&
    o.clienteId === clienteId &&
    fechaISOUY(new Date(o.deviceTs)) === fechaISOUY(ahora)
  );
}

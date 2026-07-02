// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — NÚCLEO puro de ORDEN de ruta por cercanía (vecino más cercano).
//  Ordena una lista de paradas para armar un recorrido corto desde un origen
//  (la posición actual del cobrador). Es PURO (sin React/IO): se testea solo y
//  el componente cliente solo le pasa datos. Las paradas sin GPS quedan al
//  final, en su orden original. Sin origen, no reordena.
//
//  Heurística greedy (nearest-neighbor): simple, O(n²), suficiente para las
//  ~20-40 paradas de una ruta diaria. No busca el óptimo global (eso es TSP).
// ─────────────────────────────────────────────────────────────────────────
import { distanciaMetros, type Punto } from "./geo";

export interface NodoRuta {
  id: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Reordena `nodos` como un recorrido por vecino más cercano desde `origen`.
 * Los nodos sin GPS se mantienen al final en su orden original. Si no hay
 * origen o ningún nodo tiene GPS, devuelve la lista tal cual (copia).
 */
export function ordenarPorCercania<T extends NodoRuta>(
  nodos: T[],
  origen: Punto | null,
): T[] {
  const tieneGps = (n: NodoRuta): boolean => n.lat != null && n.lng != null;
  const conGps = nodos.filter(tieneGps);
  const sinGps = nodos.filter((n) => !tieneGps(n));

  if (!origen || conGps.length === 0) return [...nodos];

  const restantes = [...conGps];
  const orden: T[] = [];
  let actual: Punto = origen;

  while (restantes.length > 0) {
    let mejorI = 0;
    let mejorD = Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const n = restantes[i];
      const d = distanciaMetros(actual, { lat: n.lat as number, lng: n.lng as number });
      if (d < mejorD) {
        mejorD = d;
        mejorI = i;
      }
    }
    const [elegido] = restantes.splice(mejorI, 1);
    orden.push(elegido);
    actual = { lat: elegido.lat as number, lng: elegido.lng as number };
  }

  return [...orden, ...sinGps];
}

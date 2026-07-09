// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO del CIERRE DE CAJA POR ZONA. Client-safe y testeable.
//  Consolida las rendiciones del día (por cobrador) agrupándolas por ZONA:
//  la cadena de custodia del efectivo es cobrador → supervisor de la zona →
//  caja central (admin). Este módulo solo agrega y suma (sin BD ni red).
//
//  Regla de dinero (espejo de lib/rendicion.ts, redondeo a peso entero):
//     esperado   = max(0, recaudado − gastos)
//     diferencia = entregado − esperado   → <0 faltante · >0 sobrante
//  Un cobrador que recaudó pero AÚN no rindió es "pendiente" (su plata sigue
//  en la calle): NO cuenta como faltante, cuenta como "por rendir".
// ─────────────────────────────────────────────────────────────────────────
import type { EstadoRendicion } from "./rendicion";

/** Estado de un cobrador en el cierre: rindió (cuadra/faltante/sobrante) o no. */
export type EstadoCobradorCierre = EstadoRendicion | "pendiente";

/** Rendición ya cerrada de un cobrador (lo mínimo para consolidar). */
export interface RendidaLite {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  gastos: number;
  entregado: number;
  diferencia: number;
  estado: EstadoRendicion;
}

/** Cobrador que recaudó hoy pero todavía no rindió. */
export interface PendienteLite {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  cobros: number;
}

/** Fila de cobrador dentro del cierre de una zona. */
export interface CobradorCierre {
  cobradorId: string;
  nombre: string;
  estado: EstadoCobradorCierre;
  recaudado: number;
  gastos: number;
  /** recaudado − gastos (nunca negativo). */
  esperado: number;
  /** Efectivo entregado (0 si aún no rindió). */
  entregado: number;
  /** entregado − esperado (0 si aún no rindió → pendiente, no faltante). */
  diferencia: number;
}

/** Confirmación del supervisor: cerró y entregó la caja de su zona (0047). */
export interface ConfirmacionCierre {
  supervisorNombre: string | null;
  totalEntregado: number;
  creadoEn: string;
}

/** Cierre consolidado de una zona (o "Sin zona"). */
export interface CierreZona {
  zonaId: string | null;
  zonaNombre: string;
  cobradores: CobradorCierre[];
  totalRecaudado: number;
  totalEsperado: number;
  totalEntregado: number;
  totalFaltante: number;
  totalSobrante: number;
  /** Recaudado por los cobradores que todavía no rindieron. */
  porRendir: number;
  rendidos: number;
  pendientes: number;
  /** Confirmación del supervisor si ya cerró la zona (se adjunta en la capa de datos). */
  confirmado?: ConfirmacionCierre | null;
}

/** Consolidado de todas las zonas visibles + su gran total. */
export interface CierreConsolidado {
  zonas: CierreZona[];
  totalRecaudado: number;
  totalEntregado: number;
  totalFaltante: number;
  totalSobrante: number;
  porRendir: number;
  rendidos: number;
  pendientes: number;
}

const NOMBRE_SIN_ZONA = "Sin zona";
const CLAVE_SIN_ZONA = "__sin_zona__";

/** Prioridad de orden dentro de una zona: faltantes → pendientes → resto. */
function prioridad(estado: EstadoCobradorCierre): number {
  if (estado === "faltante") return 0;
  if (estado === "pendiente") return 1;
  return 2;
}

/**
 * Agrupa las rendiciones (y pendientes) del día por ZONA del cobrador y suma
 * los totales de cada zona. PURA: no toca BD. La confirmación del supervisor,
 * si existe, la adjunta la capa de datos (este núcleo no la conoce).
 */
export function consolidarPorZona(
  rendidas: readonly RendidaLite[],
  pendientes: readonly PendienteLite[],
  cobradorZona: ReadonlyMap<string, string | null>,
  zonaNombre: ReadonlyMap<string, string>,
): CierreConsolidado {
  const zonas = new Map<string, CierreZona>();

  const asegurarZona = (zonaId: string | null): CierreZona => {
    const clave = zonaId ?? CLAVE_SIN_ZONA;
    let z = zonas.get(clave);
    if (!z) {
      z = {
        zonaId,
        zonaNombre: zonaId ? (zonaNombre.get(zonaId) ?? NOMBRE_SIN_ZONA) : NOMBRE_SIN_ZONA,
        cobradores: [],
        totalRecaudado: 0,
        totalEsperado: 0,
        totalEntregado: 0,
        totalFaltante: 0,
        totalSobrante: 0,
        porRendir: 0,
        rendidos: 0,
        pendientes: 0,
        confirmado: null,
      };
      zonas.set(clave, z);
    }
    return z;
  };

  for (const r of rendidas) {
    const z = asegurarZona(cobradorZona.get(r.cobradorId) ?? null);
    const esperado = Math.max(0, Math.round(r.recaudado) - Math.round(r.gastos));
    z.cobradores.push({
      cobradorId: r.cobradorId,
      nombre: r.nombre,
      estado: r.estado,
      recaudado: r.recaudado,
      gastos: r.gastos,
      esperado,
      entregado: r.entregado,
      diferencia: r.diferencia,
    });
    z.totalRecaudado += r.recaudado;
    z.totalEsperado += esperado;
    z.totalEntregado += r.entregado;
    if (r.diferencia < 0) z.totalFaltante += -r.diferencia;
    else if (r.diferencia > 0) z.totalSobrante += r.diferencia;
    z.rendidos += 1;
  }

  for (const p of pendientes) {
    const z = asegurarZona(cobradorZona.get(p.cobradorId) ?? null);
    z.cobradores.push({
      cobradorId: p.cobradorId,
      nombre: p.nombre,
      estado: "pendiente",
      recaudado: p.recaudado,
      gastos: 0,
      esperado: Math.max(0, Math.round(p.recaudado)),
      entregado: 0,
      diferencia: 0,
    });
    z.totalRecaudado += p.recaudado;
    z.porRendir += p.recaudado;
    z.pendientes += 1;
  }

  // Orden interno: primero lo que reclama atención (faltantes, luego sin rendir).
  for (const z of zonas.values()) {
    z.cobradores.sort(
      (a, b) => prioridad(a.estado) - prioridad(b.estado) || a.nombre.localeCompare(b.nombre),
    );
  }

  // Orden de zonas: la que más ruido hace primero (faltante, luego por rendir).
  const lista = [...zonas.values()].sort(
    (a, b) =>
      b.totalFaltante - a.totalFaltante ||
      b.porRendir - a.porRendir ||
      a.zonaNombre.localeCompare(b.zonaNombre),
  );

  const tot = lista.reduce(
    (s, z) => {
      s.totalRecaudado += z.totalRecaudado;
      s.totalEntregado += z.totalEntregado;
      s.totalFaltante += z.totalFaltante;
      s.totalSobrante += z.totalSobrante;
      s.porRendir += z.porRendir;
      s.rendidos += z.rendidos;
      s.pendientes += z.pendientes;
      return s;
    },
    {
      totalRecaudado: 0,
      totalEntregado: 0,
      totalFaltante: 0,
      totalSobrante: 0,
      porRendir: 0,
      rendidos: 0,
      pendientes: 0,
    },
  );

  return { zonas: lista, ...tot };
}

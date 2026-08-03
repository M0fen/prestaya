// ─────────────────────────────────────────────────────────────────────────
//  Núcleo PURO del CIERRE DE CAJA POR ZONA. Client-safe y testeable.
//  Consolida las rendiciones del día (por cobrador) agrupándolas por ZONA:
//  la cadena de custodia del efectivo es cobrador → supervisor de la zona →
//  caja central (admin). Este módulo solo agrega y suma (sin BD ni red).
//
//  Regla de dinero (espejo de lib/rendicion.ts, redondeo a peso entero):
//     esperado   = max(0, base + recaudado − gastos)
//     diferencia = entregado − esperado   → <0 faltante · >0 sobrante
//  `base` = efectivo de arranque que el supervisor le dio al cobrador (0105);
//  base=0 (default) → conducta previa. La diferencia ya viene calculada con base
//  desde el cierre; acá recomputamos el esperado con base para que sea coherente.
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
  /** Base de arranque congelada en la rendición (0105). Default 0. */
  base?: number;
  /** Recaudo EN VIVO (no el congelado al cerrar). Si supera `recaudado`, cobró
   *  DESPUÉS de rendir → esa plata quedó fuera de esta rendición. */
  recaudadoVivo?: number;
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
  /** Base de arranque del cobrador (0105). 0 si no tiene / aún no rindió. */
  base: number;
  /** base + recaudado − gastos (nunca negativo). */
  esperado: number;
  /** Efectivo entregado (0 si aún no rindió). */
  entregado: number;
  /** entregado − esperado (0 si aún no rindió → pendiente, no faltante). */
  diferencia: number;
  /** Cobró DESPUÉS de rendir (recaudoVivo − recaudado congelado). Esa plata NO
   *  entró a esta rendición → se avisa (si no, se ve "Cuadra" y queda fuera del libro). */
  cobroPostCierre?: number;
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
  /** Cobradores ACTIVOS de la zona que hoy no registraron NI UN cobro (la adjunta la
   *  capa de datos, que es la que conoce el plantel). No son "pendientes" —no tienen
   *  plata declarada— pero el supervisor tiene que verlos antes de sellar: puede ser
   *  franco, o puede ser que la app no le esté funcionando a alguien y su recaudo del
   *  día entero quede fuera de un cierre que es inmutable. */
  sinActividad?: { cobradorId: string; nombre: string }[];
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
/** Clave del bucket de cobradores sin zona (interior / no asignados a un supervisor).
 *  El ADMIN puede sellar su "Caja del día" con esta clave (ver cierreZona action). */
export const CLAVE_SIN_ZONA = "__sin_zona__";

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
    const base = Math.round(r.base ?? 0);
    const esperado = Math.max(0, base + Math.round(r.recaudado) - Math.round(r.gastos));
    // Cobró después de rendir: el recaudo vivo supera el congelado al cerrar.
    const cobroPostCierre = Math.max(0, Math.round(r.recaudadoVivo ?? r.recaudado) - Math.round(r.recaudado));
    z.cobradores.push({
      cobradorId: r.cobradorId,
      nombre: r.nombre,
      estado: r.estado,
      recaudado: r.recaudado,
      gastos: r.gastos,
      base,
      esperado,
      entregado: r.entregado,
      diferencia: r.diferencia,
      cobroPostCierre,
    });
    // Redondeo defensivo por simetría con `esperado` (hoy los valores ya son enteros
    // desde la capa de datos; esto blinda contra un monto fraccionario a futuro).
    z.totalRecaudado += Math.round(r.recaudado) + cobroPostCierre;
    // El esperado de la ZONA incluye lo que el cobrador cobró DESPUÉS de rendir:
    // esa plata está físicamente en su bolsillo y el supervisor la tiene que
    // recibir hoy. Si no se suma, el sello —que es ÚNICO e INMUTABLE por zona/día
    // (0047 + 0124)— nace declarando un total que ya sabemos incompleto, y no hay
    // forma de corregirlo después: el cobrador no puede volver a rendir (unique
    // cobrador+fecha) y el cierre no se puede editar. Sumándolo, el hueco aflora
    // como FALTANTE en el mismo momento del cierre, que es cuando todavía se puede
    // ir a buscar el efectivo. (La fila del cobrador conserva la `diferencia` que
    // él firmó en su rendición; el badge "cobró después" ya la muestra aparte.)
    z.totalEsperado += esperado + cobroPostCierre;
    z.totalEntregado += Math.round(r.entregado);
    const faltanteFila = -Math.round(r.diferencia) + cobroPostCierre;
    if (faltanteFila > 0) z.totalFaltante += faltanteFila;
    else if (faltanteFila < 0) z.totalSobrante += -faltanteFila;
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
      base: 0,
      esperado: Math.max(0, Math.round(p.recaudado)),
      entregado: 0,
      diferencia: 0,
    });
    z.totalRecaudado += Math.round(p.recaudado);
    z.porRendir += Math.round(p.recaudado);
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

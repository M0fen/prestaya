// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECAUDO DE HOY, autoritativo y con DESGLOSE.
//  Es la ÚNICA verdad del "cobro del día": suma de TODOS los pagos NO anulados
//  registrados hoy (día de Uruguay, medianoche → ahora), del libro de pagos
//  inmutable. Además desglosa esa plata entre:
//    · enRuta   = pagos en créditos ACTIVOS (la ruta que trabajan los cobradores)
//    · enCerrados = pagos en créditos ya finalizados/incobrables (históricos)
//  Ese desglose EXPLICA por qué el mapa de Cobranza (solo ruta activa) muestra
//  menos que el total del día. Nada se estima: se cuenta el efectivo real.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { traerTodo } from "./paginado";
import { alcanceDelActor, prestamoIdsDelAlcance, type Alcance } from "./alcance";

export interface RecaudoHoy {
  /** Fecha calendario de Uruguay (YYYY-MM-DD). */
  fecha: string;
  /** VERDAD: todos los cobros del día (no anulados). */
  total: number;
  cobros: number;
  /** Cobradores distintos que registraron algún cobro hoy. */
  cobradores: number;
  /** Cobros en créditos ACTIVOS (la ruta). */
  enRuta: number;
  cobrosRuta: number;
  /** Cobros en créditos ya cerrados/históricos (finalizados/incobrables). */
  enCerrados: number;
  cobrosCerrados: number;
}

const N = (v: unknown) => Number(v);

export async function getRecaudoHoy(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcancePre?: Alcance,
  // Perf: si el caller ya tiene el set de IDs de préstamos ACTIVOS (de la RPC de
  // cartera), lo pasa para clasificar ruta/cerrados en memoria y ahorrarse la
  // consulta de estados. Igual de exacto (un pago es "en ruta" ⟺ su crédito está
  // activo). Sin el set, se consulta `prestamos.estado` como siempre.
  activosPrestamoIds?: Set<string> | null,
): Promise<RecaudoHoy> {
  const desde = inicioDiaUYIso(hoy);
  const hasta = hoy.toISOString(); // "hoy hasta ahora" (igual que el resto del panel)

  // Alcance por CRÉDITO (canónico, consistente con cartera/mora/dashboard — deuda #8):
  // el supervisor cuenta los pagos sobre los créditos de SUS clientes, sin importar
  // quién los registró (un pago de OFICINA/PANEL sobre un crédito de la zona SÍ cuenta,
  // igual que en el Dashboard). Antes se filtraba por `registrado_por` → Cobranza quedaba
  // por debajo del Dashboard para el supervisor. Admin (global) → sin filtro.
  const alcance = alcancePre ?? (await alcanceDelActor());
  const zonaCreditos = alcance.global ? null : await prestamoIdsDelAlcance(alcance);
  if (zonaCreditos && zonaCreditos.size === 0) {
    return {
      fecha: toIso(hoyUY(hoy)),
      total: 0, cobros: 0, cobradores: 0,
      enRuta: 0, cobrosRuta: 0, enCerrados: 0, cobrosCerrados: 0,
    };
  }

  // Todos los pagos NO anulados de hoy (paginado, orden estable). Es el libro
  // inmutable: esto NO se estima, se suma tal cual quedó registrado en la calle.
  // El scope por-crédito no se pone en la query (miles de ids → URL larga de PostgREST):
  // se traen los pagos del día y se filtran por el set de la zona en memoria.
  const pagosRaw = await traerTodo<{ prestamo_id: string; monto: number; registrado_por: string | null }>((d, h) =>
    db
      .from("pagos")
      .select("prestamo_id, monto, registrado_por")
      .eq("anulado", false)
      .gte("registrado_en", desde)
      .lte("registrado_en", hasta)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const pagos = zonaCreditos ? pagosRaw.filter((p) => zonaCreditos.has(p.prestamo_id)) : pagosRaw;

  // Estado del crédito de cada pago (para partir ruta vs cerrados). Si el caller
  // nos pasó el set de créditos activos, clasificamos con él (0 consultas); si no,
  // consultamos `prestamos.estado` en lotes.
  let activosSet = activosPrestamoIds ?? null;
  if (!activosSet) {
    const ids = [...new Set(pagos.map((p) => p.prestamo_id))];
    const estado = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) {
      const lote = ids.slice(i, i + 300);
      const { data } = await db.from("prestamos").select("id, estado").in("id", lote);
      for (const pr of data ?? []) estado.set(pr.id as string, pr.estado as string);
    }
    activosSet = new Set([...estado.entries()].filter(([, e]) => e === "activo").map(([id]) => id));
  }

  let total = 0;
  let enRuta = 0;
  let enCerrados = 0;
  let cobrosRuta = 0;
  let cobrosCerrados = 0;
  const cobradores = new Set<string>();
  for (const p of pagos) {
    const m = N(p.monto);
    total += m;
    if (p.registrado_por) cobradores.add(p.registrado_por);
    if (activosSet.has(p.prestamo_id)) {
      enRuta += m;
      cobrosRuta += 1;
    } else {
      enCerrados += m;
      cobrosCerrados += 1;
    }
  }

  return {
    fecha: toIso(hoyUY(hoy)),
    total: Math.round(total),
    cobros: pagos.length,
    cobradores: cobradores.size,
    enRuta: Math.round(enRuta),
    cobrosRuta,
    enCerrados: Math.round(enCerrados),
    cobrosCerrados,
  };
}

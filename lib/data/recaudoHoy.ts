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
import { alcanceDelActor, type Alcance } from "./alcance";

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
): Promise<RecaudoHoy> {
  const desde = inicioDiaUYIso(hoy);
  const hasta = hoy.toISOString(); // "hoy hasta ahora" (igual que el resto del panel)

  // Alcance: admin ve TODO; el supervisor solo lo que registraron SUS cobradores
  // (así el total es consistente con su Cobranza acotada, no el global).
  const alcance = alcancePre ?? (await alcanceDelActor());
  const soloCobradores = alcance.global ? null : alcance.cobradorIds;

  // Todos los pagos NO anulados de hoy (paginado, orden estable). Es el libro
  // inmutable: esto NO se estima, se suma tal cual quedó registrado en la calle.
  const pagos =
    soloCobradores && soloCobradores.length === 0
      ? []
      : await traerTodo<{ prestamo_id: string; monto: number; registrado_por: string | null }>((d, h) => {
          let q = db
            .from("pagos")
            .select("prestamo_id, monto, registrado_por")
            .eq("anulado", false)
            .gte("registrado_en", desde)
            .lte("registrado_en", hasta);
          if (soloCobradores) q = q.in("registrado_por", soloCobradores);
          return q.order("id", { ascending: true }).range(d, h);
        });

  // Estado del crédito de cada pago (para partir ruta vs cerrados), en lotes.
  const ids = [...new Set(pagos.map((p) => p.prestamo_id))];
  const estado = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const lote = ids.slice(i, i + 300);
    const { data } = await db.from("prestamos").select("id, estado").in("id", lote);
    for (const pr of data ?? []) estado.set(pr.id as string, pr.estado as string);
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
    if (estado.get(p.prestamo_id) === "activo") {
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

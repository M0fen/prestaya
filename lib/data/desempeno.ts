// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — DESEMPEÑO POR RANGO (historial del admin/supervisor).
//  Agrega el rendimiento de TODOS los cobradores en un rango [desde, hasta]
//  (ambos extremos ACOTADOS, a diferencia de las vistas "de hoy" que van de
//  medianoche hasta ahora): recaudado, # cobros, días activos y — si hubo
//  rendiciones — entregado/faltantes. Todo del libro de pagos inmutable, nada
//  se estima. Corre como gestor y se acota por `alcance` (supervisor → su zona).
// ─────────────────────────────────────────────────────────────────────────
import { diaUYInicioIso, diaUYFinIso, fechaISOUY } from "@/lib/fecha";
import { traerTodo } from "./paginado";
import { enLotes, type Alcance } from "./alcance";
import { tablaFaltante } from "./errores";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** Tope defensivo: un trimestre. Evita barrer 100k+ pagos si piden un rango enorme. */
export const MAX_DIAS_DESEMPENO = 92;

export interface DesempenoCobrador {
  cobradorId: string;
  nombre: string;
  zonaNombre: string | null;
  /** Suma de pagos que ESTE cobrador registró en el rango (por registrado_por). */
  recaudado: number;
  cobros: number;
  /** Días distintos (UY) en los que registró al menos un cobro. */
  diasActivos: number;
  /** Efectivo entregado en sus rendiciones del rango (0 si no hay 0013). */
  entregado: number;
  rendiciones: number;
  faltantes: number;
  montoFaltante: number;
}

export interface DesempenoRango {
  desde: string; // "YYYY-MM-DD" (día UY, inclusivo)
  hasta: string; // "YYYY-MM-DD" (día UY, inclusivo)
  dias: number; // días calendario del rango
  totalRecaudado: number;
  totalCobros: number;
  cobradoresActivos: number;
  cobradores: DesempenoCobrador[]; // ordenados por recaudado desc
  porZona: { zonaNombre: string; recaudado: number; cobros: number }[];
  serie: { fecha: string; recaudado: number; cobros: number }[]; // un punto por día
  disponibleRendiciones: boolean;
  /** true si el rango pedido superaba el tope y se acotó. */
  recortado: boolean;
}

// ── Aritmética de fechas "YYYY-MM-DD" en UTC (sin líos de TZ) ───────────────
const ymdToUTC = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const utcToYmd = (t: number): string => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
const diasEntre = (a: string, b: string): number => Math.round((ymdToUTC(b) - ymdToUTC(a)) / 864e5);
const sumarDias = (ymd: string, n: number): string => utcToYmd(ymdToUTC(ymd) + n * 864e5);
function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let t = ymdToUTC(desde); t <= ymdToUTC(hasta); t += 864e5) out.push(utcToYmd(t));
  return out;
}

export async function getDesempenoRango(
  rango: { desde: string; hasta: string }, // "YYYY-MM-DD"
  alcance: Alcance,
): Promise<DesempenoRango> {
  // Lecturas con el cliente ADMIN (service_role): el RLS por-fila sobre `pagos`
  // (158k filas) vuelve lentísima la consulta a escala (medido: 27s vs 0,4s). El
  // scope se aplica EXPLÍCITO por `alcance` (el supervisor solo ve a SUS cobradores
  // vía `.in(registrado_por, cobradorIds)`), igual que en alcance.ts / RPC definer.
  const db = createSupabaseAdmin();
  // Normaliza (desde ≤ hasta) y clampa al tope defensivo.
  let desde = rango.desde;
  let hasta = rango.hasta;
  if (diasEntre(desde, hasta) < 0) [desde, hasta] = [hasta, desde];
  let recortado = false;
  if (diasEntre(desde, hasta) + 1 > MAX_DIAS_DESEMPENO) {
    desde = sumarDias(hasta, -(MAX_DIAS_DESEMPENO - 1));
    recortado = true;
  }
  const dias = diasEntre(desde, hasta) + 1;

  const desdeIso = diaUYInicioIso(desde); // inclusivo
  const hastaIso = diaUYFinIso(hasta); // EXCLUSIVO (inicio del día siguiente)
  const soloCobradores = alcance.global ? null : alcance.cobradorIds;

  const vacio = (): DesempenoRango => ({
    desde,
    hasta,
    dias,
    totalRecaudado: 0,
    totalCobros: 0,
    cobradoresActivos: 0,
    cobradores: [],
    porZona: [],
    serie: diasDelRango(desde, hasta).map((f) => ({ fecha: f, recaudado: 0, cobros: 0 })),
    disponibleRendiciones: true,
    recortado,
  });
  // Supervisor sin cobradores en su zona → nada que mostrar.
  if (soloCobradores && soloCobradores.length === 0) return vacio();

  // 1) Pagos del rango (ambos extremos acotados), paginados con orden estable.
  //    Es el libro inmutable; se acota por `registrado_por` = cobrador que cobró.
  const pagos = await traerTodo<{ monto: number; registrado_por: string | null; registrado_en: string }>((d, h) => {
    let q = db
      .from("pagos")
      .select("monto, registrado_por, registrado_en")
      .eq("anulado", false)
      .gte("registrado_en", desdeIso)
      .lt("registrado_en", hastaIso);
    if (soloCobradores) q = q.in("registrado_por", soloCobradores);
    return q.order("id", { ascending: true }).range(d, h);
  });

  const porCob = new Map<string, { recaudado: number; cobros: number; dias: Set<string> }>();
  const porDia = new Map<string, { recaudado: number; cobros: number }>();
  let totalRecaudado = 0;
  let totalCobros = 0;
  for (const p of pagos) {
    if (!p.registrado_en) continue; // sin timestamp no se puede ubicar en el día
    const m = Number(p.monto);
    const diaStr = fechaISOUY(new Date(p.registrado_en));
    totalRecaudado += m;
    totalCobros += 1;
    const dd = porDia.get(diaStr) ?? { recaudado: 0, cobros: 0 };
    dd.recaudado += m;
    dd.cobros += 1;
    porDia.set(diaStr, dd);
    const cid = p.registrado_por as string | null;
    if (!cid) continue;
    const a = porCob.get(cid) ?? { recaudado: 0, cobros: 0, dias: new Set<string>() };
    a.recaudado += m;
    a.cobros += 1;
    a.dias.add(diaStr);
    porCob.set(cid, a);
  }

  // 2) Rendiciones del rango (columna `fecha` es date → comparación directa).
  const rendPorCob = new Map<string, { entregado: number; rendiciones: number; faltantes: number; montoFaltante: number }>();
  let disponibleRendiciones = true;
  try {
    let q = db.from("rendiciones").select("cobrador_id, entregado, diferencia").gte("fecha", desde).lte("fecha", hasta);
    if (soloCobradores) q = q.in("cobrador_id", soloCobradores);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data ?? []) {
      const cid = r.cobrador_id as string;
      const dif = Number(r.diferencia);
      const a = rendPorCob.get(cid) ?? { entregado: 0, rendiciones: 0, faltantes: 0, montoFaltante: 0 };
      a.entregado += Number(r.entregado);
      a.rendiciones += 1;
      if (dif < 0) {
        a.faltantes += 1;
        a.montoFaltante += -dif;
      }
      rendPorCob.set(cid, a);
    }
  } catch (e) {
    if (tablaFaltante(e)) disponibleRendiciones = false;
    else throw e;
  }

  // 3) Nombres de cobradores + su zona (para etiquetar y agrupar).
  const ids = new Set<string>([...porCob.keys(), ...rendPorCob.keys()]);
  const nombre = new Map<string, string>();
  const zonaDe = new Map<string, string | null>();
  for (const lote of enLotes([...ids])) {
    const { data } = await db.from("usuarios").select("id, nombre, zona_id").in("id", lote);
    for (const u of data ?? []) {
      nombre.set(u.id as string, u.nombre as string);
      zonaDe.set(u.id as string, (u.zona_id as string | null) ?? null);
    }
  }
  const zonaNombre = new Map<string, string>();
  try {
    const { data, error } = await db.from("zonas").select("id, nombre");
    if (error) throw error;
    for (const z of data ?? []) zonaNombre.set(z.id as string, z.nombre as string);
  } catch {
    /* zonas bloqueadas por RLS para el supervisor con zona → sin etiqueta */
  }

  const cobradores: DesempenoCobrador[] = [...ids]
    .map((cid) => {
      const a = porCob.get(cid);
      const r = rendPorCob.get(cid);
      const zid = zonaDe.get(cid) ?? null;
      return {
        cobradorId: cid,
        nombre: nombre.get(cid) ?? "Cobrador",
        zonaNombre: zid ? zonaNombre.get(zid) ?? null : null,
        recaudado: Math.round(a?.recaudado ?? 0),
        cobros: a?.cobros ?? 0,
        diasActivos: a?.dias.size ?? 0,
        entregado: Math.round(r?.entregado ?? 0),
        rendiciones: r?.rendiciones ?? 0,
        faltantes: r?.faltantes ?? 0,
        montoFaltante: Math.round(r?.montoFaltante ?? 0),
      };
    })
    .sort((x, y) => y.recaudado - x.recaudado);

  const zAcc = new Map<string, { recaudado: number; cobros: number }>();
  for (const c of cobradores) {
    const k = c.zonaNombre ?? "Sin zona";
    const z = zAcc.get(k) ?? { recaudado: 0, cobros: 0 };
    z.recaudado += c.recaudado;
    z.cobros += c.cobros;
    zAcc.set(k, z);
  }
  const porZona = [...zAcc.entries()]
    .map(([zn, v]) => ({ zonaNombre: zn, recaudado: v.recaudado, cobros: v.cobros }))
    .sort((a, b) => b.recaudado - a.recaudado);

  const serie = diasDelRango(desde, hasta).map((f) => ({
    fecha: f,
    recaudado: Math.round(porDia.get(f)?.recaudado ?? 0),
    cobros: porDia.get(f)?.cobros ?? 0,
  }));

  return {
    desde,
    hasta,
    dias,
    totalRecaudado: Math.round(totalRecaudado),
    totalCobros,
    cobradoresActivos: [...porCob.values()].filter((a) => a.cobros > 0).length,
    cobradores,
    porZona,
    serie,
    disponibleRendiciones,
    recortado,
  };
}

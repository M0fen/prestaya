// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — DESEMPEÑO POR RANGO (historial del admin/supervisor).
//  Agrega el rendimiento de TODOS los cobradores en un rango [desde, hasta]:
//  recaudado, # cobros, días activos y — si hubo rendiciones — entregado/faltantes.
//  A ESCALA (mes/año): la suma de pagos la hace la RPC `app_desempeno_rango`
//  (GROUP BY en SQL, definer, guardada por rol) → milisegundos en vez de traer
//  cientos de miles de filas a JS. Si 0058 no corrió, degrada a un escaneo con
//  el cliente admin. El scope por zona lo aplica el alcance (supervisor → su zona).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { diaUYInicioIso, diaUYFinIso, fechaISOUY } from "@/lib/fecha";
import { traerTodo } from "./paginado";
import { enLotes, type Alcance } from "./alcance";
import { tablaFaltante } from "./errores";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { reportarError } from "@/lib/observabilidad";

/** Tope defensivo: un año. Con el GROUP BY en SQL, un año es barato. */
export const MAX_DIAS_DESEMPENO = 366;
/** Tope de emergencia del FALLBACK (escaneo sin RPC): evita OOM si 0058 faltara y
 *  el rango fuera enorme. Con la RPC presente (prod) este camino no se usa. */
const MAX_FILAS_FALLBACK = 500_000;

export interface DesempenoCobrador {
  cobradorId: string;
  nombre: string;
  zonaNombre: string | null;
  recaudado: number;
  cobros: number;
  diasActivos: number;
  entregado: number;
  rendiciones: number;
  faltantes: number;
  montoFaltante: number;
}

export interface DesempenoRango {
  desde: string;
  hasta: string;
  dias: number;
  totalRecaudado: number;
  totalCobros: number;
  cobradoresActivos: number;
  cobradores: DesempenoCobrador[];
  porZona: { zonaNombre: string; recaudado: number; cobros: number }[];
  serie: { fecha: string; recaudado: number; cobros: number }[];
  disponibleRendiciones: boolean;
  recortado: boolean;
}

// ── Aritmética de fechas "YYYY-MM-DD" en UTC ────────────────────────────────
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

interface Aggregado {
  porCob: Map<string, { recaudado: number; cobros: number; diasActivos: number }>;
  porDia: Map<string, { recaudado: number; cobros: number }>;
  totalRecaudado: number;
  totalCobros: number;
}

/** Suma de pagos del rango por cobrador y por día. RPC (rápida) con fallback a
 *  escaneo con admin client si la RPC (0058) todavía no existe. */
async function agregarPagos(
  db: SupabaseClient,
  desdeIso: string,
  hastaIso: string,
  soloCob: string[] | null,
): Promise<Aggregado> {
  // 1) RPC definer (GROUP BY en SQL). Se llama con el cliente del GESTOR: la RPC
  //    está guardada por `app_es_gestor()` (con service_role devolvería vacío).
  try {
    const { data, error } = await db.rpc("app_desempeno_rango", {
      desde: desdeIso,
      hasta: hastaIso,
      p_cobradores: soloCob,
    });
    if (error) throw error;
    const payload = (data ?? {}) as {
      por_cobrador?: { cobrador_id: string; recaudado: number; cobros: number; dias_activos: number }[];
      por_dia?: { fecha: string; recaudado: number; cobros: number }[];
    };
    const porCob = new Map<string, { recaudado: number; cobros: number; diasActivos: number }>();
    let totalRecaudado = 0;
    let totalCobros = 0;
    for (const r of payload.por_cobrador ?? []) {
      const recaudado = Number(r.recaudado);
      const cobros = Number(r.cobros);
      porCob.set(r.cobrador_id, { recaudado, cobros, diasActivos: Number(r.dias_activos) });
      totalRecaudado += recaudado;
      totalCobros += cobros;
    }
    const porDia = new Map<string, { recaudado: number; cobros: number }>();
    for (const d of payload.por_dia ?? []) porDia.set(d.fecha, { recaudado: Number(d.recaudado), cobros: Number(d.cobros) });
    return { porCob, porDia, totalRecaudado, totalCobros };
  } catch (e) {
    if (!tablaFaltante(e)) throw e; // solo degradamos si la RPC no existe (0058 sin correr)
  }

  // 2) Fallback: escaneo con el cliente admin (bypassa RLS por-fila). Scope por
  //    `registrado_por` (soloCob). Igual de exacto, más lento a escala.
  //    VISIBLE en Sentry: si esto se activa en prod es que la RPC 0058 no está
  //    (un fallback silencioso NO debe volverse el modo normal a escala) + tope
  //    de filas de emergencia para no reventar la instancia con un rango enorme.
  reportarError(
    "desempeno.fallback_sin_rpc",
    new Error("app_desempeno_rango ausente: escaneo con admin client (¿0058 sin correr?)"),
    { desdeIso, hastaIso, soloCob: soloCob?.length ?? "global" },
  );
  const admin = createSupabaseAdmin();
  const pagos = await traerTodo<{ monto: number; registrado_por: string | null; registrado_en: string }>((d, h) => {
    let q = admin
      .from("pagos")
      .select("monto, registrado_por, registrado_en")
      .eq("anulado", false)
      .gte("registrado_en", desdeIso)
      .lt("registrado_en", hastaIso);
    if (soloCob) q = q.in("registrado_por", soloCob);
    return q.order("id", { ascending: true }).range(d, h);
  }, 1000, MAX_FILAS_FALLBACK);
  const cob = new Map<string, { recaudado: number; cobros: number; dias: Set<string> }>();
  const porDia = new Map<string, { recaudado: number; cobros: number }>();
  let totalRecaudado = 0;
  let totalCobros = 0;
  for (const p of pagos) {
    if (!p.registrado_en) continue;
    const m = Number(p.monto);
    const diaStr = fechaISOUY(new Date(p.registrado_en));
    totalRecaudado += m;
    totalCobros += 1;
    const dd = porDia.get(diaStr) ?? { recaudado: 0, cobros: 0 };
    dd.recaudado += m;
    dd.cobros += 1;
    porDia.set(diaStr, dd);
    const cid = p.registrado_por;
    if (!cid) continue;
    const a = cob.get(cid) ?? { recaudado: 0, cobros: 0, dias: new Set<string>() };
    a.recaudado += m;
    a.cobros += 1;
    a.dias.add(diaStr);
    cob.set(cid, a);
  }
  const porCob = new Map<string, { recaudado: number; cobros: number; diasActivos: number }>();
  for (const [k, v] of cob) porCob.set(k, { recaudado: v.recaudado, cobros: v.cobros, diasActivos: v.dias.size });
  return { porCob, porDia, totalRecaudado, totalCobros };
}

export async function getDesempenoRango(
  db: SupabaseClient,
  rango: { desde: string; hasta: string },
  alcance: Alcance,
): Promise<DesempenoRango> {
  // Normaliza (desde ≤ hasta) y clampa al tope.
  let desde = rango.desde;
  let hasta = rango.hasta;
  if (diasEntre(desde, hasta) < 0) [desde, hasta] = [hasta, desde];
  let recortado = false;
  if (diasEntre(desde, hasta) + 1 > MAX_DIAS_DESEMPENO) {
    desde = sumarDias(hasta, -(MAX_DIAS_DESEMPENO - 1));
    recortado = true;
  }
  const dias = diasEntre(desde, hasta) + 1;
  const desdeIso = diaUYInicioIso(desde);
  const hastaIso = diaUYFinIso(hasta);
  const soloCob = alcance.global ? null : alcance.cobradorIds;

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
  if (soloCob && soloCob.length === 0) return vacio();

  const agg = await agregarPagos(db, desdeIso, hastaIso, soloCob);

  // Rendiciones del rango (admin client; scope por cobrador). Da entregado/faltantes.
  const admin = createSupabaseAdmin();
  const rendPorCob = new Map<string, { entregado: number; rendiciones: number; faltantes: number; montoFaltante: number }>();
  let disponibleRendiciones = true;
  try {
    // Paginado: un rango largo × muchos cobradores supera 1000 rendiciones y
    // truncaba entregado/faltantes por cobrador.
    const data = await traerTodo<{ cobrador_id: string; entregado: number; diferencia: number }>((d, h) => {
      let q = admin.from("rendiciones").select("cobrador_id, entregado, diferencia").gte("fecha", desde).lte("fecha", hasta);
      if (soloCob) q = q.in("cobrador_id", soloCob);
      return q.order("id", { ascending: true }).range(d, h);
    });
    for (const r of data) {
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

  // Nombres + zona de cada cobrador (para etiquetar/agrupar).
  const ids = new Set<string>([...agg.porCob.keys(), ...rendPorCob.keys()]);
  const nombre = new Map<string, string>();
  const zonaDe = new Map<string, string | null>();
  for (const lote of enLotes([...ids])) {
    const { data } = await admin.from("usuarios").select("id, nombre, zona_id").in("id", lote);
    for (const u of data ?? []) {
      nombre.set(u.id as string, u.nombre as string);
      zonaDe.set(u.id as string, (u.zona_id as string | null) ?? null);
    }
  }
  const zonaNombre = new Map<string, string>();
  try {
    const { data, error } = await admin.from("zonas").select("id, nombre");
    if (error) throw error;
    for (const z of data ?? []) zonaNombre.set(z.id as string, z.nombre as string);
  } catch {
    /* sin zonas → sin etiqueta */
  }

  const cobradores: DesempenoCobrador[] = [...ids]
    .map((cid) => {
      const a = agg.porCob.get(cid);
      const r = rendPorCob.get(cid);
      const zid = zonaDe.get(cid) ?? null;
      return {
        cobradorId: cid,
        nombre: nombre.get(cid) ?? "Cobrador",
        zonaNombre: zid ? zonaNombre.get(zid) ?? null : null,
        recaudado: Math.round(a?.recaudado ?? 0),
        cobros: a?.cobros ?? 0,
        diasActivos: a?.diasActivos ?? 0,
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
    recaudado: Math.round(agg.porDia.get(f)?.recaudado ?? 0),
    cobros: agg.porDia.get(f)?.cobros ?? 0,
  }));

  return {
    desde,
    hasta,
    dias,
    totalRecaudado: Math.round(agg.totalRecaudado),
    totalCobros: agg.totalCobros,
    cobradoresActivos: [...agg.porCob.values()].filter((a) => a.cobros > 0).length,
    cobradores,
    porZona,
    serie,
    disponibleRendiciones,
    recortado,
  };
}

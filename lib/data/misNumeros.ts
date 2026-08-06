// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — "MIS NÚMEROS" del cobrador (su propia foto, no la de otros).
//  Transparencia + motivación: su comisión del mes, recaudo del mes y de la
//  semana, ticket promedio, días activos y cuántas jornadas le cuadraron. Se lee
//  con el cliente admin ACOTADO a su propio id (su data) → simple y sin líos de RLS.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { traerTodo } from "./paginado";
import { inicioMesUYIso, fechaISOUY, diaUYInicioIso } from "@/lib/fecha";
import { calcularComision } from "@/lib/comision";

export interface LiquidacionPropia {
  periodoKey: string;
  monto: number;
  liquidadoEn: string;
}

export interface MisNumeros {
  /** CUSTODIA: lo que cobró con sus manos (pagos que él registró). Es su trabajo
   *  del día y la plata que tiene que rendir — NO es la base de su comisión. */
  mesRecaudado: number;
  mesCobros: number;
  mesDiasActivos: number;
  semanaRecaudado: number;
  ticketPromedio: number;
  comisionPct: number;
  comisionMes: number;
  /** Recaudado y comisión de la QUINCENA en curso (la cadencia con la que se paga).
   *  ⚠️ Base de COMISIÓN = lo cobrado sobre créditos de SU RUTA, no lo que registró
   *  él: es la atribución que usa la oficina para pagar (ver comentario abajo). */
  quincenaRecaudado: number;
  comisionQuincena: number;
  quincenaDesde: string;
  rendiciones: number;
  cuadradas: number;
  /** Comisiones YA PAGADAS al cobrador (su propio historial, más reciente primero). */
  liquidaciones: LiquidacionPropia[];
}

/**
 * Pagos, desde `desde`, sobre créditos cuya RUTA es de `cobradorId`. Es la MISMA
 * definición que la RPC `app_comision_por_ruta` (0069 + filtro `origen is null`
 * de la 0127), replicada acá porque aquella exige `app_es_gestor()` y esta
 * pantalla la mira un cobrador.
 *
 * Se resuelve en dos pasos (ids de sus créditos → pagos de esos créditos) en vez
 * de con un join embebido, para no depender del nombre de la FK en PostgREST. Los
 * ids se mandan en tandas: un cobrador con cientos de créditos haría una URL
 * demasiado larga y PostgREST la rechazaría (o peor, la truncaría).
 */
async function recaudoDeMiRuta(
  admin: ReturnType<typeof createSupabaseAdmin>,
  cobradorId: string,
  desde: string,
): Promise<{ monto: number; registrado_en: string }[]> {
  const creditos = await traerTodo<{ id: string }>((d, h) =>
    admin.from("prestamos").select("id").eq("cobrador_id", cobradorId).order("id", { ascending: true }).range(d, h),
  );
  const ids = creditos.map((c) => c.id);
  if (ids.length === 0) return [];

  const TANDA = 200;
  const out: { monto: number; registrado_en: string }[] = [];
  for (let i = 0; i < ids.length; i += TANDA) {
    const trozo = ids.slice(i, i + TANDA);
    const filas = await traerTodo<{ monto: number; registrado_en: string }>((d, h) =>
      admin
        .from("pagos")
        .select("monto, registrado_en")
        .in("prestamo_id", trozo)
        .eq("anulado", false)
        .is("origen", null)
        .gte("registrado_en", desde)
        .order("id", { ascending: true })
        .range(d, h),
    );
    out.push(...filas);
  }
  return out;
}

export async function getMisNumeros(cobradorId: string, hoy: Date = new Date()): Promise<MisNumeros> {
  const admin = createSupabaseAdmin();
  const desdeMes = inicioMesUYIso(hoy);
  const finSemana = new Date(hoy.getTime() - 6 * 864e5); // últimos 7 días (incluye hoy)
  const desde7Str = fechaISOUY(finSemana);
  const primerDelMes = `${fechaISOUY(hoy).slice(0, 7)}-01`;

  // Pagos del mes del cobrador (paginado, orden estable). SOLO nativos: la
  // "Comisión ganada este mes" tiene que prometer exactamente lo que la oficina
  // liquida (0127 = comisión solo sobre trabajo en la app). Con los imports del
  // empalme adentro, esta pantalla prometía ~$116k de agosto que el panel del
  // admin (post-0127) jamás iba a pagar → reclamo colectivo el día de pago.
  // Se trae desde el MENOR de (inicio de mes, hace 7 días): los días 1 al 6 la
  // ventana de "últimos 7 días" cruza al mes anterior, y cortando en el 1 el KPI
  // mentía para abajo (el día 1 mostraba solo lo de hoy). ⚠️ Ampliar la consulta
  // obliga a filtrar los acumuladores del MES dentro del loop: sin ese guard,
  // `mesRecaudado` se llevaría días del mes pasado.
  const desdeDatos = desdeMes < diaUYInicioIso(desde7Str) ? desdeMes : diaUYInicioIso(desde7Str);
  const pagos = await traerTodo<{ monto: number; registrado_en: string }>((d, h) =>
    admin
      .from("pagos")
      .select("monto, registrado_en")
      .eq("registrado_por", cobradorId)
      .eq("anulado", false)
      .is("origen", null)
      .gte("registrado_en", desdeDatos)
      .order("id", { ascending: true })
      .range(d, h),
  );

  // Quincena en curso (1–15 / 16–fin): la cadencia con la que se LIQUIDA la
  // comisión. Arranca siempre dentro del mes → se deriva del mismo set de pagos.
  const hoyStr = fechaISOUY(hoy);
  const quincenaDesde =
    Number(hoyStr.slice(8, 10)) <= 15 ? `${hoyStr.slice(0, 7)}-01` : `${hoyStr.slice(0, 7)}-16`;

  // CUSTODIA: su trabajo del mes (lo que registró él). No es base de comisión.
  let mesRecaudado = 0;
  let semanaRecaudado = 0;
  const dias = new Set<string>();
  let mesCobros = 0;
  for (const p of pagos) {
    const m = Number(p.monto);
    const dstr = fechaISOUY(new Date(p.registrado_en));
    // Guard del mes: el set trae días del mes anterior para el KPI de 7 días.
    if (dstr >= primerDelMes) {
      mesRecaudado += m;
      mesCobros += 1;
      dias.add(dstr);
    }
    if (dstr >= desde7Str) semanaRecaudado += m;
  }
  const ticketPromedio = mesCobros > 0 ? Math.round(mesRecaudado / mesCobros) : 0;

  // ── BASE DE LA COMISIÓN: lo cobrado sobre créditos de SU RUTA ──────────────
  // ⚠️ NO es lo mismo que lo de arriba, y la diferencia es plata. La oficina
  // liquida por DUEÑO DE LA RUTA (`prestamos.cobrador_id`, RPC
  // `app_comision_por_ruta` de la 0069/0127); esta pantalla venía prometiendo por
  // `registrado_por` (quien tocó el billete). Con 59 clientes compartidos entre
  // dos rutas, el que cobraba en la ruta del compañero veía esa comisión como
  // suya y la oficina se la pagaba al OTRO → reclamo garantizado el día de pago,
  // que es exactamente lo que esta función dice querer evitar.
  // No se llama a la RPC porque exige `app_es_gestor()` y acá corre la sesión de
  // un cobrador: se replica su misma definición (mismo filtro `origen is null`).
  const recaudoRuta = await recaudoDeMiRuta(admin, cobradorId, desdeMes);
  let mesRecaudadoRuta = 0;
  let quincenaRecaudadoRuta = 0;
  for (const p of recaudoRuta) {
    const m = Number(p.monto);
    mesRecaudadoRuta += m;
    if (fechaISOUY(new Date(p.registrado_en)) >= quincenaDesde) quincenaRecaudadoRuta += m;
  }

  // Comisión: % del cobrador (columna en usuarios).
  const { data: u } = await admin.from("usuarios").select("comision_pct").eq("id", cobradorId).maybeSingle();
  const comisionPct = Number(u?.comision_pct ?? 0);
  const comisionMes = comisionPct > 0 ? calcularComision(mesRecaudadoRuta, comisionPct) : 0;

  // Rendiciones del mes: cuántas cerró y cuántas cuadraron (dif = 0).
  let rendiciones = 0;
  let cuadradas = 0;
  try {
    const { data: rend, error } = await admin
      .from("rendiciones")
      .select("diferencia")
      .eq("cobrador_id", cobradorId)
      .gte("fecha", primerDelMes);
    if (error) throw error;
    rendiciones = (rend ?? []).length;
    cuadradas = (rend ?? []).filter((r) => Number(r.diferencia) === 0).length;
  } catch {
    /* sin tabla de rendiciones (0013) → 0 */
  }

  // Historial de comisiones YA pagadas (transparencia: qué cobró y cuándo). La
  // tabla es solo-gestor por RLS; acá se lee con admin ACOTADO al propio id.
  let liquidaciones: LiquidacionPropia[] = [];
  try {
    const { data: liqs, error } = await admin
      .from("comisiones_liquidadas")
      .select("periodo_key, monto, liquidado_en")
      .eq("cobrador_id", cobradorId)
      .order("liquidado_en", { ascending: false })
      .limit(12);
    if (error) throw error;
    liquidaciones = (liqs ?? []).map((l) => ({
      periodoKey: l.periodo_key as string,
      monto: Math.round(Number(l.monto) || 0),
      liquidadoEn: l.liquidado_en as string,
    }));
  } catch {
    /* sin 0049 → sin historial */
  }

  return {
    mesRecaudado: Math.round(mesRecaudado),
    mesCobros,
    mesDiasActivos: dias.size,
    semanaRecaudado: Math.round(semanaRecaudado),
    ticketPromedio,
    comisionPct,
    comisionMes,
    quincenaRecaudado: Math.round(quincenaRecaudadoRuta),
    comisionQuincena: comisionPct > 0 ? calcularComision(quincenaRecaudadoRuta, comisionPct) : 0,
    quincenaDesde,
    rendiciones,
    cuadradas,
    liquidaciones,
  };
}

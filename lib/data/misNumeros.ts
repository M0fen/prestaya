// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — "MIS NÚMEROS" del cobrador (su propia foto, no la de otros).
//  Transparencia + motivación: su comisión del mes, recaudo del mes y de la
//  semana, ticket promedio, días activos y cuántas jornadas le cuadraron. Se lee
//  con el cliente admin ACOTADO a su propio id (su data) → simple y sin líos de RLS.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { traerTodo } from "./paginado";
import { inicioMesUYIso, fechaISOUY } from "@/lib/fecha";
import { calcularComision } from "@/lib/comision";

export interface LiquidacionPropia {
  periodoKey: string;
  monto: number;
  liquidadoEn: string;
}

export interface MisNumeros {
  mesRecaudado: number;
  mesCobros: number;
  mesDiasActivos: number;
  semanaRecaudado: number;
  ticketPromedio: number;
  comisionPct: number;
  comisionMes: number;
  /** Recaudado y comisión de la QUINCENA en curso (la cadencia con la que se paga). */
  quincenaRecaudado: number;
  comisionQuincena: number;
  quincenaDesde: string;
  rendiciones: number;
  cuadradas: number;
  /** Comisiones YA PAGADAS al cobrador (su propio historial, más reciente primero). */
  liquidaciones: LiquidacionPropia[];
}

/** Fecha UY "YYYY-MM-DD" de un instante ISO. */

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
  const pagos = await traerTodo<{ monto: number; registrado_en: string }>((d, h) =>
    admin
      .from("pagos")
      .select("monto, registrado_en")
      .eq("registrado_por", cobradorId)
      .eq("anulado", false)
      .is("origen", null)
      .gte("registrado_en", desdeMes)
      .order("id", { ascending: true })
      .range(d, h),
  );

  // Quincena en curso (1–15 / 16–fin): la cadencia con la que se LIQUIDA la
  // comisión. Arranca siempre dentro del mes → se deriva del mismo set de pagos.
  const hoyStr = fechaISOUY(hoy);
  const quincenaDesde =
    Number(hoyStr.slice(8, 10)) <= 15 ? `${hoyStr.slice(0, 7)}-01` : `${hoyStr.slice(0, 7)}-16`;

  let mesRecaudado = 0;
  let semanaRecaudado = 0;
  let quincenaRecaudado = 0;
  const dias = new Set<string>();
  for (const p of pagos) {
    const m = Number(p.monto);
    mesRecaudado += m;
    const dstr = fechaISOUY(new Date(p.registrado_en));
    dias.add(dstr);
    if (dstr >= desde7Str) semanaRecaudado += m;
    if (dstr >= quincenaDesde) quincenaRecaudado += m;
  }
  const mesCobros = pagos.length;
  const ticketPromedio = mesCobros > 0 ? Math.round(mesRecaudado / mesCobros) : 0;

  // Comisión: % del cobrador (columna en usuarios).
  const { data: u } = await admin.from("usuarios").select("comision_pct").eq("id", cobradorId).maybeSingle();
  const comisionPct = Number(u?.comision_pct ?? 0);
  const comisionMes = comisionPct > 0 ? calcularComision(mesRecaudado, comisionPct) : 0;

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
    quincenaRecaudado: Math.round(quincenaRecaudado),
    comisionQuincena: comisionPct > 0 ? calcularComision(quincenaRecaudado, comisionPct) : 0,
    quincenaDesde,
    rendiciones,
    cuadradas,
    liquidaciones,
  };
}

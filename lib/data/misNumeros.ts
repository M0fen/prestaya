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

export interface MisNumeros {
  mesRecaudado: number;
  mesCobros: number;
  mesDiasActivos: number;
  semanaRecaudado: number;
  ticketPromedio: number;
  comisionPct: number;
  comisionMes: number;
  rendiciones: number;
  cuadradas: number;
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

  let mesRecaudado = 0;
  let semanaRecaudado = 0;
  const dias = new Set<string>();
  for (const p of pagos) {
    const m = Number(p.monto);
    mesRecaudado += m;
    const dstr = fechaISOUY(new Date(p.registrado_en));
    dias.add(dstr);
    if (dstr >= desde7Str) semanaRecaudado += m;
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

  return {
    mesRecaudado: Math.round(mesRecaudado),
    mesCobros,
    mesDiasActivos: dias.size,
    semanaRecaudado: Math.round(semanaRecaudado),
    ticketPromedio,
    comisionPct,
    comisionMes,
    rendiciones,
    cuadradas,
  };
}

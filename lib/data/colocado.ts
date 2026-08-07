// ─────────────────────────────────────────────────────────────────────────
//  CAPITAL COLOCADO — la plata que el cobrador sacó de su bolsillo en la calle
//  para renovar o vender. Vive en su propio módulo porque lo necesitan las DOS
//  puntas de la caja: el CIERRE de hoy (`rendicion.ts`) y el ARRASTRE de mañana
//  (`aperturas.ts`), y esas dos ya se importan entre sí.
//
//  Se DERIVA de `prestamos`, igual que el recaudo sale de `pagos`: no se guarda
//  en ningún lado y se puede recalcular para cualquier día. Por eso el arrastre
//  puede corregir hacia atrás sin migración.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { diaUYInicioIso, diaUYFinIso, fechaISOUY } from "@/lib/fecha";
import { tablaFaltante, columnaFaltante } from "./errores";
import { traerTodo } from "./paginado";

/**
 * Capital que un cobrador colocó en la calle en una ventana de tiempo.
 *
 * Se cuenta por `creado_por` —quien hizo el alta— y no por dueño de la ruta: si
 * el crédito lo dio de alta la oficina, el efectivo no salió de su bolsillo y
 * exigírselo sería inventarle un faltante.
 *
 * ⚠️ Se lee con el cliente ADMIN y el scope EXPLÍCITO por `creado_por`, igual que
 * el recaudo (`recaudadoHoyDe`). Con la sesión del cobrador, la policy
 * `prestamos_select` exige ASIGNACIÓN ACTIVA del cliente: si la oficina traspasa
 * a ese cliente a otra ruta después de la renovación, el crédito desaparece de su
 * vista y el cierre le exige de vuelta un capital que ya entregó.
 */
export async function colocadoPorCobrador(
  cobradorId: string,
  desdeIso: string,
  hastaIso?: string,
): Promise<{ colocado: number; creditos: number }> {
  try {
    const admin = createSupabaseAdmin();
    const filas = await traerTodo<{ monto_prestado: number }>((d, h) => {
      let q = admin
        .from("prestamos")
        .select("monto_prestado")
        .eq("creado_por", cobradorId)
        .gte("creado_en", desdeIso);
      if (hastaIso) q = q.lt("creado_en", hastaIso);
      return q.order("id", { ascending: true }).range(d, h);
    });
    return {
      // Suma cruda y UN solo redondeo, igual que el recaudado: redondear crédito
      // por crédito inventaba pesos de faltante con montos fraccionarios.
      colocado: Math.round(filas.reduce((s, p) => s + Number(p.monto_prestado || 0), 0)),
      creditos: filas.length,
    };
  } catch (e) {
    // Degradar a 0 SOLO si falta la tabla/columna (entorno viejo). Ante un error
    // real (timeout, 502, RLS) NO se puede seguir: colocado=0 le sella un faltante
    // por todo el capital que entregó hoy, y el cierre de jornada no se deshace.
    if (tablaFaltante(e) || columnaFaltante(e)) return { colocado: 0, creditos: 0 };
    throw e;
  }
}

/** Clave de `colocadoEnDias`: `${cobradorId}|${YYYY-MM-DD}`. */
export function claveColocado(cobradorId: string, ymd: string): string {
  return `${cobradorId}|${ymd}`;
}

/**
 * Capital colocado por VARIOS cobradores en días DISTINTOS, en una sola consulta.
 *
 * Lo necesita el ARRASTRE: la base de mañana es la cuadra de la última jornada
 * rendida de cada uno, y cada cobrador rindió su último día en una fecha propia.
 * Sin esto, el capital que el cobrador puso en la calle volvía como base del día
 * siguiente —plata que no tiene— y se auto-perpetuaba: entregaba todo, la cuadra
 * volvía a dar el mismo número y el fantasma reaparecía todos los días.
 */
export async function colocadoEnDias(
  pares: { cobradorId: string; ymd: string }[],
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (pares.length === 0) return m;
  const ymds = [...pares.map((p) => p.ymd)].sort();
  const ids = [...new Set(pares.map((p) => p.cobradorId))];
  try {
    const admin = createSupabaseAdmin();
    const filas = await traerTodo<{
      creado_por: string;
      monto_prestado: number;
      creado_en: string;
    }>((d, h) =>
      admin
        .from("prestamos")
        .select("creado_por, monto_prestado, creado_en")
        .in("creado_por", ids)
        .gte("creado_en", diaUYInicioIso(ymds[0]))
        .lt("creado_en", diaUYFinIso(ymds[ymds.length - 1]))
        .order("id", { ascending: true })
        .range(d, h),
    );
    // Agrupado por (cobrador, día UY) — la MISMA frontera de día que usa el cierre.
    const suma = new Map<string, number>();
    for (const f of filas) {
      const k = claveColocado(f.creado_por, fechaISOUY(new Date(f.creado_en)));
      suma.set(k, (suma.get(k) ?? 0) + Number(f.monto_prestado || 0));
    }
    for (const p of pares) {
      const k = claveColocado(p.cobradorId, p.ymd);
      const v = suma.get(k);
      if (v) m.set(k, Math.round(v));
    }
  } catch (e) {
    if (!(tablaFaltante(e) || columnaFaltante(e))) throw e;
  }
  return m;
}

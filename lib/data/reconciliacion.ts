// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RECONCILIACIÓN DIARIA. Llama al RPC eficiente (0071) que
//  agrega en SQL y devuelve SOLO los créditos que violan una invariante; el
//  núcleo puro (lib/reconciliacion) clasifica la severidad. Degrada a
//  "disponible:false" si el RPC aún no se corrió (Carlos corre la DDL).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconciliar,
  invRecaudoDia,
  type CreditoRecon,
  type ResumenReconciliacion,
} from "@/lib/reconciliacion";
import { inicioDiaUYIso } from "@/lib/fecha";
import { saldoCredito } from "@/lib/cartones";
import { traerTodo } from "./paginado";

export interface ResultadoReconciliacion extends ResumenReconciliacion {
  /** false si el RPC 0071 aún no existe en la base. */
  disponible: boolean;
  /** Recaudo de HOY según el libro de pagos (para el chequeo de consistencia). */
  recaudoLibro: number;
  /** Cuántos hallazgos son CRÍTICOS (lo que vale la pena alertar; el resto es baseline). */
  criticos: number;
}

const N = (v: unknown) => Math.round(Number(v) || 0);

/** Foto de salud del empalme: totales + cartera recalculada del libro. */
export async function getSaludEmpalme(db: SupabaseClient): Promise<SaludEmpalme> {
  const cnt = async (
    tabla: string,
    col?: string,
    val?: string | boolean,
  ): Promise<number> => {
    let q = db.from(tabla).select("id", { count: "exact", head: true });
    if (col !== undefined) q = q.eq(col, val as never);
    const { count } = await q;
    return count ?? 0;
  };
  const [creditosActivos, creditosFinalizados, creditosTotal, clientes, pagos] = await Promise.all([
    cnt("prestamos", "estado", "activo"),
    cnt("prestamos", "estado", "finalizado"),
    cnt("prestamos"),
    cnt("clientes", "activo", true),
    cnt("pagos", "anulado", false),
  ]);
  const { data: lp } = await db
    .from("pagos")
    .select("registrado_en")
    .eq("anulado", false)
    .order("registrado_en", { ascending: false })
    .limit(1);
  const ultimoPago = (lp?.[0]?.registrado_en as string | undefined) ?? null;

  // Cartera activa: Σ saldo (cuota×días − pagado_acum) de los activos, paginado.
  let carteraActiva = 0;
  for (let desde = 0; ; desde += 1000) {
    const { data } = await db
      .from("prestamos")
      .select("cuota_diaria, total_dias, pagado_acum")
      .eq("estado", "activo")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    for (const p of data ?? []) {
      // pagado = columna denormalizada pagado_acum (no Σpagos): se preserva tal cual.
      carteraActiva += saldoCredito(N(p.cuota_diaria), Number(p.total_dias || 0), N(p.pagado_acum));
    }
    if (!data || data.length < 1000) break;
  }
  return { creditosActivos, creditosFinalizados, creditosTotal, clientes, pagos, ultimoPago, carteraActiva };
}

/** Historial de las últimas corridas de reconciliación (tendencia). Degrada a []. */
export async function getHistorialReconciliacion(db: SupabaseClient, limite = 14): Promise<CorridaRecon[]> {
  try {
    const { data, error } = await db
      .from("reconciliacion_log")
      .select("corrida_en, ok, total, criticos, recaudo_libro, origen")
      .order("corrida_en", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      corridaEn: r.corrida_en as string,
      ok: Boolean(r.ok),
      total: Number(r.total),
      criticos: Number(r.criticos),
      recaudoLibro: N(r.recaudo_libro),
      origen: (r.origen as string) ?? "cron",
    }));
  } catch {
    return [];
  }
}

/** Deja registro de una corrida (append-only). Best-effort: nunca rompe el cron. */
export async function logReconciliacion(
  db: SupabaseClient,
  r: { ok: boolean; total: number; criticos: number; recaudoLibro: number; origen?: string; detalle?: unknown },
): Promise<void> {
  try {
    await db.from("reconciliacion_log").insert({
      ok: r.ok,
      total: r.total,
      criticos: r.criticos,
      recaudo_libro: r.recaudoLibro,
      origen: r.origen ?? "cron",
      detalle: r.detalle ?? null,
    });
  } catch {
    /* la tabla 0073 puede no existir aún: no rompe la corrida */
  }
}

/** Una diferencia de dinero con TRAZABILIDAD (quién, cuánto, de qué tipo) — para
 *  que admin/dev revisen cada divergencia del empalme. */
/** Foto de salud del empalme (totales) — para el panel de trazabilidad. */
export interface SaludEmpalme {
  creditosActivos: number;
  creditosFinalizados: number;
  creditosTotal: number;
  clientes: number;
  pagos: number;
  ultimoPago: string | null;
  /** Capital en calle = Σ saldo de créditos activos (recalculado del libro). */
  carteraActiva: number;
}

/** Una corrida registrada de reconciliación (historial/tendencia). */
export interface CorridaRecon {
  corridaEn: string;
  ok: boolean;
  total: number;
  criticos: number;
  recaudoLibro: number;
  origen: string;
}

export interface DiferenciaEmpalme {
  creditoId: string;
  clienteNombre: string;
  estado: string;
  pagadoAcum: number;
  pagosSuma: number;
  totalAPagar: number;
  /** pagado_acum − Σpagos (≠0 = el denormalizado miente). */
  drift: number;
  /** Σpagos − total (>0 = sobre-cobro). */
  exceso: number;
  tipo: "drift" | "sobrecobro";
  /** true = material (grave); false = redondeo/baseline. */
  material: boolean;
}

export interface InfoEmpalme {
  disponible: boolean;
  diferencias: DiferenciaEmpalme[];
  totalDiferencias: number;
  criticas: number;
  soloLectura: boolean;
}

/**
 * Diferencias de dinero del empalme, con nombre de cliente, para el panel de
 * trazabilidad. Usa el RPC 0071 (solo créditos que violan) + resuelve nombres.
 */
export async function getInfoEmpalme(db: SupabaseClient): Promise<InfoEmpalme> {
  const vacio: InfoEmpalme = {
    disponible: false,
    diferencias: [],
    totalDiferencias: 0,
    criticas: 0,
    soloLectura: false,
  };
  let filas: Record<string, unknown>[];
  try {
    const { data, error } = await db.rpc("app_reconciliacion_violaciones");
    if (error) throw error;
    filas = (data ?? []) as Record<string, unknown>[];
  } catch {
    return vacio;
  }

  // Nombres de clientes: crédito → cliente_id → clientes.nombre.
  const creditoIds = filas.map((r) => r.id as string);
  const nombre = new Map<string, string>();
  if (creditoIds.length > 0) {
    for (let i = 0; i < creditoIds.length; i += 200) {
      const lote = creditoIds.slice(i, i + 200);
      const { data: pr } = await db.from("prestamos").select("id, cliente_id").in("id", lote);
      const cliIds = [...new Set((pr ?? []).map((p) => p.cliente_id as string))];
      const cliDe = new Map((pr ?? []).map((p) => [p.id as string, p.cliente_id as string]));
      const { data: cl } = await db.from("clientes").select("id, nombre").in("id", cliIds);
      const nomCli = new Map((cl ?? []).map((c) => [c.id as string, c.nombre as string]));
      for (const cid of lote) nombre.set(cid, nomCli.get(cliDe.get(cid) ?? "") ?? "—");
    }
  }

  const diferencias: DiferenciaEmpalme[] = filas.map((r) => {
    const pagadoAcum = N(r.pagado_acum);
    const pagosSuma = N(r.pagos_suma);
    const totalAPagar = N(r.total_a_pagar);
    const cuota = N(r.cuota_diaria);
    const drift = pagadoAcum - pagosSuma;
    const exceso = pagosSuma - totalAPagar;
    const estado = (r.estado as string) ?? "?";
    const esDrift = Math.abs(drift) >= 1;
    // Sobre-cobro MATERIAL solo en crédito ACTIVO (se está cobrando de más AHORA).
    // Los de créditos ya finalizados son baseline del empalme → MISMO criterio que
    // el cron (`reconciliarDia`), para que el panel no marque en rojo lo que el cron
    // da por sano (antes el panel contaba finalizados y contradecía su propia leyenda).
    const materialSobre =
      exceso >= 1 &&
      estado === "activo" &&
      ((cuota > 0 && exceso >= cuota) || (totalAPagar > 0 && exceso >= totalAPagar * 0.05));
    return {
      creditoId: r.id as string,
      clienteNombre: nombre.get(r.id as string) ?? "—",
      estado,
      pagadoAcum,
      pagosSuma,
      totalAPagar,
      drift,
      exceso,
      tipo: esDrift ? "drift" : "sobrecobro",
      // Un drift del denormalizado siempre es material; un sobre-cobro, solo si activo.
      material: esDrift || materialSobre,
    };
  });
  // Más grave primero (drift, luego sobre-cobros materiales, luego el resto).
  diferencias.sort((a, b) => Number(b.material) - Number(a.material) || Math.abs(b.exceso) - Math.abs(a.exceso));

  let soloLectura = false;
  try {
    const { data } = await db
      .from("feature_flags")
      .select("activo")
      .eq("clave", "modo_solo_lectura")
      .maybeSingle();
    soloLectura = Boolean(data?.activo);
  } catch {
    /* 0072 sin correr: modo normal */
  }

  return {
    disponible: true,
    diferencias,
    totalDiferencias: diferencias.length,
    criticas: diferencias.filter((d) => d.material).length,
    soloLectura,
  };
}

/**
 * Corre la reconciliación del día. `caja` opcional: si el caller ya tiene el
 * recaudo de caja, se compara contra el libro (invariante recaudo-consistente).
 */
export async function reconciliarDia(
  db: SupabaseClient,
  hoy: Date = new Date(),
  cajaDelDia?: number | null,
): Promise<ResultadoReconciliacion> {
  const vacio: ResultadoReconciliacion = {
    ok: true,
    totalCreditos: 0,
    hallazgos: [],
    porInvariante: {},
    peorSeveridad: null,
    disponible: false,
    recaudoLibro: 0,
    criticos: 0,
  };
  let violaciones: Record<string, unknown>[];
  try {
    const { data, error } = await db.rpc("app_reconciliacion_violaciones");
    if (error) throw error;
    violaciones = (data ?? []) as Record<string, unknown>[];
  } catch {
    // RPC 0071 sin correr todavía → degrada sin romper (el cron avisa "sin correr").
    return vacio;
  }

  const creditos: CreditoRecon[] = violaciones.map((r) => ({
    id: r.id as string,
    estado: (r.estado as string) ?? "?",
    pagadoAcum: N(r.pagado_acum),
    pagosSuma: N(r.pagos_suma),
    totalAPagar: N(r.total_a_pagar),
    cuotaDiaria: N(r.cuota_diaria),
  }));

  // Recaudo del día (barato: solo hoy) para el chequeo de consistencia libro↔caja.
  const desde = inicioDiaUYIso(hoy);
  // Paginado: corre GLOBAL desde el cron (service_role); un día con >1000 pagos
  // truncaba el recaudo logueado y la respuesta del cron. (No se usa el RPC
  // app_suma_pagos_desde: el cron no es "gestor" y devolvería 0.)
  const pg = await traerTodo<{ monto: unknown }>((d, h) =>
    db
      .from("pagos")
      .select("monto")
      .eq("anulado", false)
      .gte("registrado_en", desde)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const recaudoLibro = pg.reduce((s, p) => s + N(p.monto), 0);

  const extra =
    cajaDelDia != null && cajaDelDia > 0
      ? invRecaudoDia({ pagos: recaudoLibro, caja: cajaDelDia })
      : [];

  const resumen = reconciliar(creditos, extra);
  // ALERTABLE (push diario) = problema VIVO, no el baseline histórico: un drift del
  // denormalizado (los saldos mienten, siempre grave) o un sobre-cobro MATERIAL en
  // un crédito ACTIVO (se está cobrando de más ahora). Los sobre-cobros de créditos
  // ya finalizados son un baseline pre-existente y no disparan aviso a diario.
  const criticos = creditos.filter((c) => {
    const driftAcum = Math.abs(c.pagadoAcum - c.pagosSuma) >= 1;
    const exceso = c.pagosSuma - c.totalAPagar;
    const sobreMaterial =
      exceso >= 1 &&
      ((c.cuotaDiaria > 0 && exceso >= c.cuotaDiaria) ||
        (c.totalAPagar > 0 && exceso >= c.totalAPagar * 0.05));
    return driftAcum || (c.estado === "activo" && sobreMaterial);
  }).length;
  // Sumar también los hallazgos de recaudo-consistente (caja ≠ libro) como críticos.
  const criticosRecaudo = extra.filter((h) => h.severidad === "alto" || h.severidad === "critico").length;
  return { ...resumen, disponible: true, recaudoLibro, criticos: criticos + criticosRecaudo };
}

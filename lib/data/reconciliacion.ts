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
  invBaseCaja,
  invLeadConvertido,
  invRendicionVsLibro,
  invGastosRendicion,
  type CreditoRecon,
  type Hallazgo,
  type BaseCajaRecon,
  type LeadRecon,
  type RendicionRecon,
  type GastosRecon,
  type ResumenReconciliacion,
} from "@/lib/reconciliacion";
import { inicioDiaUYIso, hoyUY, sumarDiasYmd, diaUYInicioIso } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { saldoCredito } from "@/lib/cartones";
import { reportarError } from "@/lib/observabilidad";
import { tablaFaltante } from "./errores";
import { getDiscrepanciasMap, esCerrada, type TriageDiscrepancia } from "./discrepancias";
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
    // "estimated" usa la estimación del planner (reltuples) para tablas grandes y
    // exacto para las chicas: evita el scan O(n) de un count exact. Solo para
    // números INFORMATIVOS (foto de salud), no para lógica de plata.
    modo: "exact" | "estimated" = "exact",
  ): Promise<number> => {
    let q = db.from(tabla).select("id", { count: modo, head: true });
    if (col !== undefined) q = q.eq(col, val as never);
    const { count } = await q;
    return count ?? 0;
  };
  const [creditosActivos, creditosFinalizados, creditosTotal, clientes, pagos] = await Promise.all([
    cnt("prestamos", "estado", "activo"),
    cnt("prestamos", "estado", "finalizado"),
    cnt("prestamos"),
    cnt("clientes", "activo", true),
    // `pagos` ya ronda cientos de miles y crece a millones: un count exact es un
    // scan que se pone lento y contribuye a timeouts del panel. Estimado alcanza.
    cnt("pagos", "anulado", false, "estimated"),
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
  } catch (e) {
    // La tabla 0073 puede faltar en un entorno viejo → degradar en silencio SOLO en
    // ese caso. Cualquier OTRO fallo de escritura del log (RLS, tipo, jsonb inválido)
    // es una mancha ciega en el CORAZÓN de la detección → dejar rastro en Sentry.
    if (!tablaFaltante(e)) reportarError("logReconciliacion", e);
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
  /** Estado del triage humano (0109), o null si nadie lo tocó / falta la migración. */
  triage: TriageDiscrepancia | null;
}

export interface InfoEmpalme {
  disponible: boolean;
  diferencias: DiferenciaEmpalme[];
  totalDiferencias: number;
  criticas: number;
  /** Críticas MATERIALES que NO están resueltas/aceptadas (las que reclaman acción). */
  criticasSinResolver: number;
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
    criticasSinResolver: 0,
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
      triage: null as TriageDiscrepancia | null,
    };
  });

  // Triage humano (0109): adjunta el estado de cada divergencia (degrada a null si
  // 0109 no corrió). Una crítica RESUELTA/ACEPTADA deja de reclamar acción.
  const triage = await getDiscrepanciasMap(db, filas.map((r) => r.id as string));
  for (const d of diferencias) d.triage = triage.get(d.creditoId) ?? null;

  // Más grave primero: las materiales SIN resolver arriba, luego resto por |exceso|.
  const pesoSinResolver = (d: DiferenciaEmpalme) => (d.material && !(d.triage && esCerrada(d.triage.estado)) ? 1 : 0);
  diferencias.sort(
    (a, b) => pesoSinResolver(b) - pesoSinResolver(a) || Number(b.material) - Number(a.material) || Math.abs(b.exceso) - Math.abs(a.exceso),
  );

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
    // Las que reclaman ACCIÓN: materiales que nadie resolvió/aceptó todavía.
    criticasSinResolver: diferencias.filter((d) => d.material && !(d.triage && esCerrada(d.triage.estado))).length,
    soloLectura,
  };
}

/**
 * Invariantes dinero-adyacentes del DÍA que NO vienen del RPC de saldos:
 *  · INV6 base de caja — la base del cierre = la de la apertura (una base editada
 *    tras el cierre re-escribe el "esperado" y puede enmascarar un faltante).
 *  · INV7 tienda — todo lead 'convertida' apunta a un crédito real de origen 'tienda'
 *    (una conversión a medias = deuda de tienda mal trazada, invisible sin esto).
 * Consultas ACOTADAS (por día / por estado). Degradan a [] si falta su migración; un
 * fallo real se reporta a Sentry pero NUNCA tumba el cron (best-effort).
 * INV5 (estrellas fantasma) es promocional/más pesada → follow-up separado.
 */
async function hallazgosExtraDelDia(db: SupabaseClient, hoy: Date): Promise<Hallazgo[]> {
  const fecha = toIso(hoyUY(hoy));
  // AYER: el último día COMPLETO. Las invariantes históricas (INV6/INV8/INV9) se
  // evalúan sobre ayer, no sobre hoy: el cron corre a las 07:00 UY, cuando el día
  // recién nace (apertura/rendición/gastos de HOY aún no existen → chequear hoy es
  // estructuralmente inútil; era el hueco por el que una base editada de noche, un
  // cobro post-rendición o un gasto rechazado tras el cierre morían a medianoche).
  const ayer = sumarDiasYmd(fecha, -1);
  const out: Hallazgo[] = [];

  // INV6 — base de caja consistente (apertura vs rendición del mismo cobrador/día),
  // sobre AYER: la ventana real donde ambas coexisten (≈17:00→23:59) solo es
  // observable al día siguiente.
  try {
    const [ap, re] = await Promise.all([
      db.from("aperturas_caja").select("cobrador_id, base").eq("fecha", ayer),
      db.from("rendiciones").select("cobrador_id, base").eq("fecha", ayer),
    ]);
    if (ap.error) throw ap.error;
    if (re.error) throw re.error;
    const baseRend = new Map<string, number>();
    for (const r of re.data ?? []) baseRend.set(r.cobrador_id as string, N(r.base));
    const rows: BaseCajaRecon[] = (ap.data ?? []).map((a) => {
      const cid = a.cobrador_id as string;
      return {
        cobradorId: cid,
        fecha: ayer,
        baseApertura: N(a.base),
        baseRendicion: baseRend.has(cid) ? baseRend.get(cid)! : null, // null = no rindió → no aplica
      };
    });
    out.push(...invBaseCaja(rows));
  } catch (e) {
    if (!tablaFaltante(e)) reportarError("reconciliarDia:baseCaja", e);
  }

  // INV8/INV9 — rendiciones de AYER vs libro + gastos respaldados. Re-mira el día
  // ya cerrado: cobro post-rendición, anulación posterior, cobrador que no rindió,
  // y gastos descontados que luego se rechazaron. Solo COBRADORES (un gestor que
  // registra un pago desde el panel deja esa plata en caja central: no rinde).
  try {
    const desdeAyer = diaUYInicioIso(ayer);
    const desdeHoy = diaUYInicioIso(fecha);
    const [{ data: rends, error: eR }, pagosAyer] = await Promise.all([
      db.from("rendiciones").select("cobrador_id, recaudado, gastos").eq("fecha", ayer),
      traerTodo<{ monto: unknown; registrado_por: string | null }>((d, h) =>
        db
          .from("pagos")
          .select("monto, registrado_por")
          .eq("anulado", false)
          .gte("registrado_en", desdeAyer)
          .lt("registrado_en", desdeHoy)
          .order("id", { ascending: true })
          .range(d, h),
      ),
    ]);
    if (eR) throw eR;
    const libroDe = new Map<string, number>();
    for (const p of pagosAyer) {
      if (!p.registrado_por) continue;
      libroDe.set(p.registrado_por, (libroDe.get(p.registrado_por) ?? 0) + N(p.monto));
    }
    // Rol de cada registrador: los pagos de gestores (oficina) NO exigen rendición.
    const ids = [...new Set([...libroDe.keys(), ...(rends ?? []).map((r) => r.cobrador_id as string)])];
    const esCobrador = new Set<string>();
    if (ids.length > 0) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data: us } = await db.from("usuarios").select("id, rol").in("id", ids.slice(i, i + 200));
        for (const u of us ?? []) if (u.rol === "cobrador") esCobrador.add(u.id as string);
      }
    }
    const rendDe = new Map<string, { recaudado: number; gastos: number }>();
    for (const r of rends ?? []) rendDe.set(r.cobrador_id as string, { recaudado: N(r.recaudado), gastos: N(r.gastos) });
    const filas: RendicionRecon[] = [];
    for (const id of new Set([...libroDe.keys(), ...rendDe.keys()])) {
      if (!esCobrador.has(id)) continue;
      filas.push({
        cobradorId: id,
        fecha: ayer,
        recaudadoRendicion: rendDe.get(id)?.recaudado ?? null,
        pagosSuma: libroDe.get(id) ?? 0,
      });
    }
    out.push(...invRendicionVsLibro(filas));

    // INV9 — gastos de las rendiciones de ayer vs solicitudes APROBADAS de ayer.
    const conGastos = [...rendDe.entries()].filter(([, v]) => v.gastos > 0);
    if (conGastos.length > 0) {
      const { data: sols, error: eS } = await db
        .from("solicitudes_gasto")
        .select("cobrador_id, monto, estado")
        .gte("solicitado_en", desdeAyer)
        .lt("solicitado_en", desdeHoy)
        .in("cobrador_id", conGastos.map(([id]) => id));
      if (eS) throw eS;
      const apr = new Map<string, number>();
      const pen = new Map<string, number>();
      for (const s of sols ?? []) {
        const cid = s.cobrador_id as string;
        if (s.estado === "aprobada") apr.set(cid, (apr.get(cid) ?? 0) + N(s.monto));
        else if (s.estado === "pendiente") pen.set(cid, (pen.get(cid) ?? 0) + N(s.monto));
      }
      const filasG: GastosRecon[] = conGastos.map(([id, v]) => ({
        cobradorId: id,
        fecha: ayer,
        gastosRendicion: v.gastos,
        gastosAprobados: apr.get(id) ?? 0,
        gastosPendientes: pen.get(id) ?? 0,
      }));
      out.push(...invGastosRendicion(filasG));
    }
  } catch (e) {
    if (!tablaFaltante(e)) reportarError("reconciliarDia:rendicionesAyer", e);
  }

  // INV7 — lead de tienda 'convertida' → crédito existente de origen 'tienda'.
  try {
    const { data: leads, error } = await db
      .from("solicitudes_producto")
      .select("id, estado, prestamo_id")
      .eq("estado", "convertida");
    if (error) throw error;
    const filas = leads ?? [];
    if (filas.length > 0) {
      const pids = [
        ...new Set(filas.map((l) => l.prestamo_id as string | null).filter((x): x is string => !!x)),
      ];
      const origenDe = new Map<string, string | null>();
      if (pids.length > 0) {
        const { data: pr } = await db.from("prestamos").select("id, origen").in("id", pids);
        for (const p of pr ?? []) origenDe.set(p.id as string, (p.origen as string | null) ?? null);
      }
      const rows: LeadRecon[] = filas.map((l) => {
        const pid = (l.prestamo_id as string | null) ?? null;
        return {
          leadId: l.id as string,
          estado: l.estado as string,
          prestamoId: pid,
          prestamoExiste: pid ? origenDe.has(pid) : false,
          prestamoOrigen: pid ? (origenDe.get(pid) ?? null) : null,
        };
      });
      out.push(...invLeadConvertido(rows));
    }
  } catch (e) {
    if (!tablaFaltante(e)) reportarError("reconciliarDia:leadTienda", e);
  }

  return out;
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

  // Extra del día: recaudo libro↔caja (INV3, si el caller pasó la caja) + base de caja
  // (INV6) + lead de tienda (INV7). Antes solo corrían INV1/INV2 (saldos) — INV6/INV7
  // eran código de detección MUERTO (existían y testeadas, pero nada las ejecutaba).
  const extra: Hallazgo[] = [
    ...(cajaDelDia != null && cajaDelDia > 0
      ? invRecaudoDia({ pagos: recaudoLibro, caja: cajaDelDia })
      : []),
    ...(await hallazgosExtraDelDia(db, hoy)),
  ];

  const resumen = reconciliar(creditos, extra);
  // Triage humano (0109): una divergencia ya RESUELTA/ACEPTADA (baseline conocido)
  // no debe re-alertar a diario — si no, el push gritaría lo mismo cada mañana y se
  // volvería ruido. Coherente con el panel (criticasSinResolver). Degrada si 0109 falta.
  const triage = await getDiscrepanciasMap(db, creditos.map((c) => c.id));
  // ALERTABLE (push diario) = problema VIVO y NO aceptado: un drift del denormalizado
  // (los saldos mienten, siempre grave) o un sobre-cobro MATERIAL en un crédito ACTIVO
  // (se está cobrando de más ahora), que nadie haya revisado/aceptado todavía.
  const criticos = creditos.filter((c) => {
    const t = triage.get(c.id);
    if (t && esCerrada(t.estado)) return false; // ya revisado/aceptado → no re-alerta
    const driftAcum = Math.abs(c.pagadoAcum - c.pagosSuma) >= 1;
    const exceso = c.pagosSuma - c.totalAPagar;
    const sobreMaterial =
      exceso >= 1 &&
      ((c.cuotaDiaria > 0 && exceso >= c.cuotaDiaria) ||
        (c.totalAPagar > 0 && exceso >= c.totalAPagar * 0.05));
    return driftAcum || (c.estado === "activo" && sobreMaterial);
  }).length;
  // Sumar los hallazgos EXTRA alto/crítico (recaudo caja≠libro, base de caja editada,
  // lead de tienda mal convertido) a los críticos alertables del día.
  const criticosExtra = extra.filter((h) => h.severidad === "alto" || h.severidad === "critico").length;
  return { ...resumen, disponible: true, recaudoLibro, criticos: criticos + criticosExtra };
}

// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RESUMEN FINANCIERO para el asesor IA (admin/supervisor).
//  Junta la foto real de la operación (cartera, recaudación, mora, cobradores)
//  reusando las métricas ya existentes, y la vuelca a un texto compacto que se
//  le pasa como CONTEXTO al modelo. Así el asesor no inventa: aconseja sobre
//  los números reales del negocio. Corre como gestor (RLS ve todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardMetricas } from "./metricas";
import { getTableroMora } from "./mora";
import { getControlCobranza } from "./control";
import { getSerieRecaudo } from "./series";
import { getPrestamosActivosPorCliente } from "./prestamos";
import { getActivosConPagos } from "./activos";
import { getPagosDePrestamo } from "./pagos";
import { getHistorialCrediticio } from "./scoring";
import { getNotasCliente } from "./notas";
import { calcularEstadosCarton } from "@/lib/cartones";
import { calcularScore } from "@/lib/scoring";
import { hoyUY } from "@/lib/fecha";
import { UYU } from "@/lib/format";

export interface ResumenFinanciero {
  fecha: string;
  cartera: {
    capitalColocado: number;
    carteraPorCobrar: number;
    creditosActivos: number;
    clientesActivos: number;
    creditosFinalizados: number;
    incobrables: number;
  };
  recaudacion: { hoy: number; mes: number };
  mora: {
    monto: number;
    morosos: number;
    moraPct: number; // 0..1 sobre la cartera por cobrar
    tramos: { tramo: string; creditos: number; monto: number }[];
    criticos: number;
    topRiesgo: {
      nombre: string;
      riesgo: number;
      nivel: string;
      deudaVencida: number;
      diasSinPagar: number;
      cobrador: string | null;
    }[];
  };
  cobradores: {
    ranking: {
      nombre: string;
      recaudado: number;
      esperado: number;
      progresoPct: number;
      anomalias: number;
    }[];
    alertas: { severidad: string; titulo: string; detalle: string }[];
  };
}

export async function getResumenFinanciero(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<ResumenFinanciero> {
  // Se trae la cartera activa UNA vez y se comparte entre métricas y mora
  // (ambas corren el cartón sobre los mismos créditos → media RPC menos).
  const activos = await getActivosConPagos(db);
  const [dash, mora, control] = await Promise.all([
    getDashboardMetricas(db, hoy, activos),
    getTableroMora(db, hoy, activos),
    getControlCobranza(db, hoy, activos),
  ]);

  const moraPct = dash.carteraPorCobrar > 0 ? dash.montoEnMora / dash.carteraPorCobrar : 0;

  return {
    fecha: hoy.toISOString(),
    cartera: {
      capitalColocado: dash.capitalColocado,
      carteraPorCobrar: dash.carteraPorCobrar,
      creditosActivos: dash.creditosActivos,
      clientesActivos: dash.clientesActivos,
      creditosFinalizados: dash.creditosFinalizados,
      incobrables: dash.incobrables,
    },
    recaudacion: { hoy: dash.recaudadoHoy, mes: dash.recaudadoMes },
    mora: {
      monto: dash.montoEnMora,
      morosos: dash.morosos,
      moraPct,
      tramos: dash.tramosMora,
      criticos: mora.resumen.critico,
      topRiesgo: mora.enRiesgo.slice(0, 6).map((c) => ({
        nombre: c.nombre,
        riesgo: c.alerta.riesgo,
        nivel: c.alerta.nivel,
        deudaVencida: c.alerta.senales.deudaVencida,
        diasSinPagar: c.alerta.senales.diasSinPagar,
        cobrador: c.cobradorNombre,
      })),
    },
    cobradores: {
      ranking: control.ranking.map((r) => ({
        nombre: r.nombre,
        recaudado: r.recaudado,
        esperado: r.esperado,
        progresoPct: Math.round(r.progreso * 100),
        anomalias: r.anomalias,
      })),
      alertas: control.alertas.slice(0, 8).map((a) => ({
        severidad: a.severidad,
        titulo: a.titulo,
        detalle: a.detalle,
      })),
    },
  };
}

// ── Herramienta del asesor: perfil de UN cliente por nombre ────────────────

/**
 * Busca clientes por nombre y devuelve el perfil financiero del mejor match en
 * TEXTO (para que el modelo lo lea). Es la "mano" del asesor: puede consultar a
 * cualquier cliente, no solo a los del resumen. Corre como gestor (RLS).
 */
export async function buscarClientePerfil(
  db: SupabaseClient,
  nombre: string,
  hoy: Date = new Date(),
): Promise<string> {
  const q = (nombre ?? "").trim();
  if (q.length < 2) return "Nombre demasiado corto para buscar.";

  const { data, error } = await db
    .from("clientes")
    .select("id, nombre, documento, telefono, direccion")
    .ilike("nombre", `%${q}%`)
    .eq("activo", true)
    .limit(5);
  if (error) return "No se pudo buscar el cliente.";
  if (!data || data.length === 0) return `No hay ningún cliente activo que coincida con "${q}".`;

  const elegido = data[0];
  const otros =
    data.length > 1
      ? ` (hay ${data.length - 1} coincidencia(s) más: ${data.slice(1).map((c) => c.nombre).join(", ")})`
      : "";

  const clienteId = elegido.id as string;
  const hoyCal = hoyUY(hoy);
  const L: string[] = [];
  L.push(`PERFIL DE CLIENTE: ${elegido.nombre}${otros}`);
  L.push(`- Documento: ${elegido.documento ?? "s/d"} · Tel: ${elegido.telefono ?? "s/d"} · Dir: ${elegido.direccion ?? "s/d"}`);

  // Créditos activos + cartón (desde 0037 pueden ser varios).
  const activos = await getPrestamosActivosPorCliente(db, clienteId);
  if (activos.length === 0) {
    L.push(`- Sin crédito activo.`);
  } else {
    if (activos.length > 1) L.push(`- Tiene ${activos.length} créditos activos:`);
    for (let i = 0; i < activos.length; i++) {
      const prestamo = activos[i];
      const pagos = await getPagosDePrestamo(db, prestamo.id);
      const r = calcularEstadosCarton(prestamo, pagos, hoyCal);
      const pagados = r.dias.filter((d) => d.estado === "pagado").length;
      const atrasados = r.dias.filter((d) => d.estado === "atrasado").length;
      const pref = activos.length > 1 ? `  · Crédito ${i + 1}:` : "- Crédito activo:";
      L.push(
        `${pref} cuota ${UYU(prestamo.cuota_diaria)} × ${prestamo.total_dias} días. Pagó ${pagados}/${prestamo.total_dias}. ` +
          `Saldo ${UYU(r.falta)}, deuda vencida ${UYU(r.montoParaAlDia)}, días atrasados ${atrasados}.` +
          (r.proxima ? ` Próxima: día ${r.proxima.dia} (${r.proxima.fecha}).` : ""),
      );
    }
  }

  // Score interno.
  try {
    const hist = await getHistorialCrediticio(db, clienteId);
    const score = calcularScore({ ...hist, hoy: hoyCal });
    L.push(
      `- Score interno: ${score.puntaje}/1000 (${score.banda}). Recomendación: ${score.recomendacion.resumen}`,
    );
  } catch {
    /* si falla el score, seguimos sin él */
  }

  // Últimas notas del equipo.
  const notas = await getNotasCliente(db, clienteId);
  if (notas.length > 0) {
    L.push(`- Últimas notas del equipo:`);
    for (const n of notas.slice(0, 3)) L.push(`  · "${n.cuerpo}" — ${n.autorNombre}`);
  }

  // Id para que el asesor pueda ofrecer el enlace a la ficha (ver prompt).
  L.push(`ID_FICHA: ${clienteId} | ${elegido.nombre}`);

  return L.join("\n");
}

// ── Herramienta: ruta y rendimiento de UN cobrador ─────────────────────────

/** Resumen de hoy de un cobrador (recaudación, avance, anomalías) en TEXTO. */
export async function rutaCobradorTexto(
  db: SupabaseClient,
  nombre: string,
  hoy: Date = new Date(),
): Promise<string> {
  const q = (nombre ?? "").trim().toLowerCase();
  if (q.length < 2) return "Nombre demasiado corto para buscar el cobrador.";

  const control = await getControlCobranza(db, hoy);
  const r = control.ranking.find((c) => c.nombre.toLowerCase().includes(q));
  if (!r) {
    const nombres = control.ranking.map((c) => c.nombre).join(", ") || "ninguno";
    return `No encontré un cobrador que coincida con "${nombre}". Cobradores activos: ${nombres}.`;
  }

  const L: string[] = [];
  L.push(`RUTA DE HOY — ${r.nombre}:`);
  L.push(
    `- Recaudó ${UYU(r.recaudado)} de ${UYU(r.esperado)} esperado (${Math.round(r.progreso * 100)}%).`,
  );
  L.push(`- Clientes cobrados: ${r.cobrados} · pendientes: ${r.pendientes} · anomalías: ${r.anomalias}.`);
  const alertas = control.alertas.filter((a) => a.detalle.includes(r.nombre));
  if (alertas.length > 0) {
    L.push(`- Alertas:`);
    for (const a of alertas) L.push(`  · [${a.severidad}] ${a.titulo}: ${a.detalle}`);
  }
  return L.join("\n");
}

// ── Herramienta: proyección de caja (ingreso esperado) ─────────────────────

/** Proyección de ingreso de los próximos `dias` según la cuota diaria de los
 *  créditos activos (escenario "si cobran al día"), en TEXTO. */
export async function proyeccionCajaTexto(
  db: SupabaseClient,
  dias: number,
  hoy: Date = new Date(),
): Promise<string> {
  const N = Math.max(1, Math.min(90, Math.round(dias || 30)));
  const { data: presRaw, error } = await db
    .from("prestamos")
    .select("id, cuota_diaria, total_dias, frecuencia, fecha_inicio")
    .eq("estado", "activo");
  if (error) return "No se pudo calcular la proyección.";
  const activos = presRaw ?? [];
  if (activos.length === 0) return "No hay créditos activos: la proyección de caja es 0.";

  const ids = activos.map((p) => p.id as string);
  const { data: pagosRaw } = await db
    .from("pagos")
    .select("prestamo_id, dia_credito, monto")
    .in("prestamo_id", ids)
    .eq("anulado", false);
  const pagosDe = new Map<string, { dia_credito: number; monto: number }[]>();
  for (const p of pagosRaw ?? []) {
    const arr = pagosDe.get(p.prestamo_id as string) ?? [];
    arr.push({ dia_credito: Number(p.dia_credito), monto: Number(p.monto) });
    pagosDe.set(p.prestamo_id as string, arr);
  }

  const hoyCal = hoyUY(hoy);
  let totalHorizonte = 0;
  let ingresoDiario = 0;
  let vencidoYa = 0;
  for (const p of activos) {
    const cuota = Number(p.cuota_diaria);
    const r = calcularEstadosCarton(
      {
        cuota_diaria: cuota,
        total_dias: Number(p.total_dias),
        frecuencia: (p.frecuencia as "diario") ?? "diario",
        fecha_inicio: p.fecha_inicio as string,
      },
      pagosDe.get(p.id as string) ?? [],
      hoyCal,
    );
    if (r.falta <= 0) continue;
    // Escenario "cobra la cuota cada día": aporta cuota×N, tope el saldo.
    totalHorizonte += Math.min(r.falta, cuota * N);
    ingresoDiario += cuota;
    vencidoYa += r.montoParaAlDia;
  }

  return [
    `PROYECCIÓN DE CAJA (próximos ${N} días):`,
    `- Ingreso esperado si se cobra la cuota diaria: ~${UYU(totalHorizonte)}.`,
    `- Ingreso diario teórico (suma de cuotas activas): ~${UYU(ingresoDiario)}/día.`,
    `- Además hay ${UYU(vencidoYa)} de mora YA vencida por recuperar (aparte de lo de arriba).`,
    `- Nota: es el escenario ideal; el ingreso real depende del cumplimiento (mirá la mora).`,
  ].join("\n");
}

// ── Herramienta: tablero de mora (morosos priorizados por riesgo) ──────────

/** Lista los créditos en mora ordenados por riesgo, en TEXTO. */
export async function tableroMoraTexto(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<string> {
  const t = await getTableroMora(db, hoy);
  if (t.enRiesgo.length === 0) return "No hay créditos en mora ni en riesgo hoy. Cartera al día.";

  const L: string[] = [];
  L.push(
    `TABLERO DE MORA: ${t.enRiesgo.length} crédito(s) en riesgo (crítico ${t.resumen.critico}, alto ${t.resumen.alto}, medio ${t.resumen.medio}).`,
  );
  for (const c of t.enRiesgo.slice(0, 12)) {
    const s = c.alerta.senales;
    L.push(
      `- ${c.nombre}: riesgo ${c.alerta.riesgo}/100 (${c.alerta.nivel}), debe ${UYU(s.deudaVencida)}, ${s.diasSinPagar} día(s) sin pagar${c.cobradorNombre ? `, cobrador ${c.cobradorNombre}` : ""}. Acción: ${c.alerta.accionSugerida}`,
    );
  }
  return L.join("\n");
}

// ── Herramienta: ranking de cobradores del día ─────────────────────────────

/** Rendimiento comparado de todos los cobradores hoy, en TEXTO. */
export async function rankingCobradoresTexto(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<string> {
  const c = await getControlCobranza(db, hoy);
  if (c.ranking.length === 0) return "No hay cobradores activos con ruta hoy.";

  const L: string[] = [];
  L.push(
    `RANKING DE COBRADORES (hoy): ${c.resumen.cobradores} activo(s), ${UYU(c.resumen.recaudadoHoy)} recaudados en ${c.resumen.cobrosHoy} cobro(s), ${c.resumen.fueraZona} fuera de zona.`,
  );
  c.ranking.forEach((r, i) => {
    L.push(
      `${i + 1}. ${r.nombre}: ${UYU(r.recaudado)} de ${UYU(r.esperado)} (${Math.round(r.progreso * 100)}%), ${r.cobrados} cobrados, ${r.pendientes} pendientes${r.anomalias > 0 ? `, ${r.anomalias} anomalía(s)` : ""}.`,
    );
  });
  if (c.alertas.length > 0) {
    L.push(`Alertas: ${c.alertas.map((a) => `[${a.severidad}] ${a.titulo}`).join("; ")}.`);
  }
  return L.join("\n");
}

// ── Herramienta: tendencia de recaudo (serie de días) ──────────────────────

/** Serie de recaudo de los últimos N días + tendencia, en TEXTO. */
export async function tendenciaRecaudoTexto(
  db: SupabaseClient,
  dias = 14,
  hoy: Date = new Date(),
): Promise<string> {
  const s = await getSerieRecaudo(db, hoy, dias);
  const dir = s.tendencia > 0.05 ? "en alza" : s.tendencia < -0.05 ? "en baja" : "estable";
  const L: string[] = [];
  L.push(
    `TENDENCIA DE RECAUDO (últimos ${s.dias.length} días): total ${UYU(s.total)}, promedio ${UYU(s.promedio)}/día, hoy ${UYU(s.hoy)}. Tendencia ${dir} (${Math.round(s.tendencia * 100)}% vs los 3 días previos).`,
  );
  L.push(
    "Detalle: " + s.dias.map((d) => `${d.etiqueta} ${UYU(d.recaudado)}`).join(" · "),
  );
  return L.join("\n");
}

/** Vuelca el resumen a un texto compacto y legible para el modelo (contexto). */
export function resumenComoTexto(r: ResumenFinanciero): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const L: string[] = [];
  L.push(`FOTO DE LA OPERACIÓN (moneda: pesos uruguayos, UYU).`);
  L.push("");
  L.push(`CARTERA:`);
  L.push(`- Capital colocado (activo): ${UYU(r.cartera.capitalColocado)}`);
  L.push(`- Cartera por cobrar (saldo): ${UYU(r.cartera.carteraPorCobrar)}`);
  L.push(`- Créditos activos: ${r.cartera.creditosActivos} · clientes activos: ${r.cartera.clientesActivos}`);
  L.push(`- Créditos finalizados: ${r.cartera.creditosFinalizados} · incobrables: ${r.cartera.incobrables}`);
  L.push("");
  L.push(`RECAUDACIÓN:`);
  L.push(`- Hoy: ${UYU(r.recaudacion.hoy)} · Este mes: ${UYU(r.recaudacion.mes)}`);
  L.push("");
  L.push(`MORA:`);
  L.push(`- Monto en mora: ${UYU(r.mora.monto)} (${pct(r.mora.moraPct)} de la cartera por cobrar)`);
  L.push(`- Créditos morosos: ${r.mora.morosos} · en estado crítico: ${r.mora.criticos}`);
  for (const t of r.mora.tramos)
    L.push(`  · ${t.tramo}: ${t.creditos} crédito(s), ${UYU(t.monto)}`);
  if (r.mora.topRiesgo.length > 0) {
    L.push(`- Clientes de mayor riesgo:`);
    for (const c of r.mora.topRiesgo)
      L.push(
        `  · ${c.nombre} — riesgo ${c.riesgo}/100 (${c.nivel}), debe ${UYU(c.deudaVencida)}, ${c.diasSinPagar} días sin pagar${c.cobrador ? `, cobrador ${c.cobrador}` : ""}`,
      );
  }
  L.push("");
  L.push(`COBRADORES (hoy):`);
  if (r.cobradores.ranking.length === 0) L.push(`- (sin cobradores activos)`);
  for (const c of r.cobradores.ranking)
    L.push(
      `- ${c.nombre}: recaudó ${UYU(c.recaudado)} de ${UYU(c.esperado)} esperado (${c.progresoPct}%)${c.anomalias > 0 ? `, ${c.anomalias} anomalía(s)` : ""}`,
    );
  if (r.cobradores.alertas.length > 0) {
    L.push("");
    L.push(`ALERTAS ACTIVAS:`);
    for (const a of r.cobradores.alertas) L.push(`- [${a.severidad}] ${a.titulo}: ${a.detalle}`);
  }
  return L.join("\n");
}

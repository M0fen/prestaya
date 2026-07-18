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
import { getControlCobranza, type ControlCobranza } from "./control";
import { getSerieRecaudo } from "./series";
import { getPrestamosActivosPorCliente } from "./prestamos";
import { getActivosConPagos, pagosDeActivo, type ActivoConPagos } from "./activos";
import { getInformeCartera } from "./informeCartera";
import { alcanceDelActor, enLotes, type Alcance } from "./alcance";
import { getPagosDePrestamo } from "./pagos";
import { getHistorialCrediticio } from "./scoring";
import { getNotasCliente } from "./notas";
import { calcularEstadosCarton } from "@/lib/cartones";
import { sanearTextoLibre } from "@/lib/asesor/sanear";
import { calcularScore } from "@/lib/scoring";
import { hoyUY, diasCobrablesProximos } from "@/lib/fecha";
import { UYU } from "@/lib/format";

export interface ResumenFinanciero {
  fecha: string;
  cartera: {
    capitalColocado: number;
    /** Total a cobrar (capital + interés) = "Con Intereses". */
    conIntereses: number;
    /** Abonado acumulado a la cartera activa = "Recaudo". */
    recaudadoAcumulado: number;
    carteraPorCobrar: number;
    /** Cuotas que vencen hoy y aún no se saldaron. */
    porCobrarHoy: number;
    creditosActivos: number;
    /** Clientes registrados en la base (tengan crédito o no). */
    clientesActivos: number;
    /** Clientes con al menos un crédito activo (deudores reales). */
    deudoresActivos: number;
    creditosFinalizados: number;
    incobrables: number;
  };
  recaudacion: { hoy: number; mes: number };
  /** Reportes de discrepancia sin atender (acotado a la zona del gestor). */
  reportesNuevos: number;
  mora: {
    monto: number;
    morosos: number;
    moraPct: number; // 0..1 sobre la cartera por cobrar
    tramos: { tramo: string; creditos: number; monto: number }[];
    criticos: number;
    /** Créditos activos de plazo vencido e impagos (cartera vencida / castigo).
     *  Aparte de la mora del día para no inflarla. */
    vencidosCreditos: number;
    carteraVencida: number;
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
  // Inyección de dependencias (perf): páginas que ya resolvieron el alcance, la
  // cartera activa (RPC cara) o el control de cobranza pueden pasarlos para no
  // recomputarlos. P. ej. "Mi jornada" comparte activos+control con el cierre y
  // las alertas → la RPC `app_cartera_activa` y el control corren UNA vez, no dos.
  deps?: { alcance?: Alcance; activos?: ActivoConPagos[]; control?: ControlCobranza },
): Promise<ResumenFinanciero> {
  // Alcance del gestor (una vez): admin → todo; supervisor → su zona. Se pasa a
  // cada consumidor para no re-resolverlo 3 veces.
  const alcance = deps?.alcance ?? (await alcanceDelActor());
  // Se trae la cartera activa UNA vez (ya acotada) y se comparte entre métricas
  // y mora (ambas corren el cartón sobre los mismos créditos → media RPC menos).
  const activos = deps?.activos ?? (await getActivosConPagos(db, alcance));
  const [dash, mora, control] = await Promise.all([
    getDashboardMetricas(db, hoy, activos, alcance),
    getTableroMora(db, hoy, activos),
    deps?.control ?? getControlCobranza(db, hoy, activos, alcance),
  ]);

  const moraPct = dash.carteraPorCobrar > 0 ? dash.montoEnMora / dash.carteraPorCobrar : 0;

  return {
    fecha: hoy.toISOString(),
    cartera: {
      capitalColocado: dash.capitalColocado,
      conIntereses: dash.totalConIntereses,
      recaudadoAcumulado: dash.recaudadoAcumulado,
      carteraPorCobrar: dash.carteraPorCobrar,
      porCobrarHoy: dash.porCobrarHoy,
      creditosActivos: dash.creditosActivos,
      clientesActivos: dash.clientesActivos,
      deudoresActivos: dash.deudoresActivos,
      creditosFinalizados: dash.creditosFinalizados,
      incobrables: dash.incobrables,
    },
    recaudacion: { hoy: dash.recaudadoHoy, mes: dash.recaudadoMes },
    reportesNuevos: dash.reportesNuevos,
    mora: {
      monto: dash.montoEnMora,
      morosos: dash.morosos,
      moraPct,
      tramos: dash.tramosMora,
      criticos: mora.resumen.critico,
      vencidosCreditos: dash.carteraVencidaCreditos,
      carteraVencida: dash.carteraVencidaMonto,
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
 * TEXTO (para que el modelo lo lea). Es la "mano" del asesor. ACOTADO POR ZONA:
 * un SUPERVISOR solo puede consultar clientes de SU zona (no de otras); el admin,
 * cualquiera. Corre como gestor.
 */
export async function buscarClientePerfil(
  db: SupabaseClient,
  nombre: string,
  hoy: Date = new Date(),
): Promise<string> {
  const q = (nombre ?? "").trim();
  if (q.length < 2) return "Nombre demasiado corto para buscar.";

  type FilaCli = {
    id: string;
    nombre: string;
    documento: string | null;
    telefono: string | null;
    direccion: string | null;
  };
  const cols = "id, nombre, documento, telefono, direccion";

  // Recorte por zona ANTES de buscar: el admin busca en toda la base; el
  // supervisor busca SOLO entre los clientes de su zona (en lotes, para no armar
  // una URL gigante). Así no pasa que los 10 primeros globales sean de otra zona
  // y parezca que el cliente "no existe" cuando sí está en la suya.
  const alcance = await alcanceDelActor();
  // Escapa los comodines de LIKE (%, _) para que la búsqueda sea literal. `.ilike`
  // parametriza el patrón (sin riesgo de inyección de filtro), pero esto evita que
  // un `%` en el término abra la búsqueda a toda la cartera.
  const patron = q.replace(/[%_]/g, (m) => `\\${m}`);
  let matches: FilaCli[] = [];
  if (alcance.global) {
    const { data, error } = await db.from("clientes").select(cols).ilike("nombre", `%${patron}%`).eq("activo", true).limit(10);
    if (error) return "No se pudo buscar el cliente.";
    matches = (data ?? []) as FilaCli[];
  } else {
    if (alcance.clienteIds.length === 0) return "No tenés clientes en tu zona todavía.";
    for (const lote of enLotes(alcance.clienteIds)) {
      const { data, error } = await db.from("clientes").select(cols).ilike("nombre", `%${patron}%`).eq("activo", true).in("id", lote).limit(10);
      if (error) return "No se pudo buscar el cliente.";
      matches.push(...((data ?? []) as FilaCli[]));
      if (matches.length >= 10) break;
    }
  }
  if (matches.length === 0)
    return `No hay ningún cliente activo${alcance.global ? "" : " en tu zona"} que coincida con "${q}".`;
  const data5 = matches.slice(0, 5);

  const elegido = data5[0];
  const otros =
    data5.length > 1
      ? ` (hay ${data5.length - 1} coincidencia(s) más: ${data5.slice(1).map((c) => sanearTextoLibre(c.nombre, 80)).join(", ")})`
      : "";

  const clienteId = elegido.id as string;
  const hoyCal = hoyUY(hoy);
  const L: string[] = [];
  // Texto libre que escribe la gente (nombre/documento/tel/dirección/notas) → SANEADO
  // antes de entrar al prompt: es la superficie de prompt-injection del asesor.
  const nombreLimpio = sanearTextoLibre(elegido.nombre, 80);
  L.push(`PERFIL DE CLIENTE: ${nombreLimpio}${otros}`);
  L.push(
    `- Documento: ${sanearTextoLibre(elegido.documento, 40) || "s/d"} · Tel: ${sanearTextoLibre(elegido.telefono, 40) || "s/d"} · Dir: ${sanearTextoLibre(elegido.direccion, 120) || "s/d"}`,
  );

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
    // Las NOTAS son el vector más expuesto: texto libre y multilínea.
    for (const n of notas.slice(0, 3))
      L.push(`  · "${sanearTextoLibre(n.cuerpo, 300)}" — ${sanearTextoLibre(n.autorNombre, 60)}`);
  }

  // Id para que el asesor pueda ofrecer el enlace a la ficha (ver prompt).
  L.push(`ID_FICHA: ${clienteId} | ${nombreLimpio}`);

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
  // Créditos activos + total pagado en UNA RPC (antes: un .in() de pagos que se
  // truncaba a 1000 filas → proyección mal calculada con miles de créditos).
  const activos = await getActivosConPagos(db);
  if (activos.length === 0) return "No hay créditos activos: la proyección de caja es 0.";

  const hoyCal = hoyUY(hoy);
  // No se cobra los domingos: el horizonte se mide en días de COBRO, no calendario.
  const diasCobro = diasCobrablesProximos(hoyCal, N);
  let totalHorizonte = 0;
  let ingresoDiario = 0;
  let vencidoYa = 0;
  for (const a of activos) {
    const cuota = Number(a.cuota_diaria);
    const r = calcularEstadosCarton(
      {
        cuota_diaria: cuota,
        total_dias: Number(a.total_dias),
        frecuencia: a.frecuencia ?? "diario",
        fecha_inicio: a.fecha_inicio,
      },
      pagosDeActivo(a),
      hoyCal,
    );
    if (r.falta <= 0) continue;
    // Escenario "cobra la cuota cada día hábil": aporta cuota×(días de cobro), tope el saldo.
    totalHorizonte += Math.min(r.falta, cuota * diasCobro);
    ingresoDiario += cuota;
    vencidoYa += r.montoParaAlDia;
  }

  return [
    `PROYECCIÓN DE CAJA (próximos ${N} días → ${diasCobro} de cobro, Lun–Sáb):`,
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

// ── Herramienta: RENTABILIDAD / utilidad de la cartera (contable) ──────────

/** Utilidad proyectada, margen y desglose por cobrador, en TEXTO. Solo dueño. */
export async function rentabilidadTexto(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<string> {
  const inf = await getInformeCartera(db, {}, hoy);
  if (inf.filas.length === 0) return "No hay créditos activos para calcular rentabilidad.";
  const margen = inf.totalVenta > 0 ? (inf.utilidadProyectada / inf.totalVenta) * 100 : 0;

  // Utilidad y cartera por cobrador.
  const porCob = new Map<string, { cartera: number; utilidad: number; saldo: number; creditos: number }>();
  for (const f of inf.filas) {
    const k = f.vendedor ?? "Sin asignar";
    const a = porCob.get(k) ?? { cartera: 0, utilidad: 0, saldo: 0, creditos: 0 };
    a.cartera += f.venta;
    a.utilidad += Math.max(0, f.total - f.venta);
    a.saldo += f.saldoPte;
    a.creditos += 1;
    porCob.set(k, a);
  }
  const top = [...porCob.entries()].sort((a, b) => b[1].utilidad - a[1].utilidad).slice(0, 8);

  const L: string[] = [];
  L.push(`RENTABILIDAD / UTILIDAD (cartera activa, proyectada):`);
  L.push(`- Capital colocado: ${UYU(inf.totalVenta)} · Total a cobrar con interés: ${UYU(inf.totalConIntereses)}`);
  L.push(`- Utilidad proyectada (interés a ganar si todos pagan): ${UYU(inf.utilidadProyectada)} → margen ${Math.round(margen)}% sobre el capital.`);
  L.push(`- Ya recaudado de esta cartera: ${UYU(inf.totalRecaudado)} · Saldo por cobrar: ${UYU(inf.deudaTotalAHoy)}`);
  L.push(`- Utilidad por cobrador (top, proyectada):`);
  for (const [nom, v] of top) {
    const m = v.cartera > 0 ? Math.round((v.utilidad / v.cartera) * 100) : 0;
    L.push(`  · ${nom}: cartera ${UYU(v.cartera)} en ${v.creditos} créd., utilidad ${UYU(v.utilidad)} (margen ${m}%), saldo ${UYU(v.saldo)}`);
  }
  L.push(`Nota contable: la utilidad es PROYECTADA (interés total pactado, no todo cobrado aún). Para la GANANCIA NETA real restá gastos operativos, comisiones (~3% del recaudo) y la mora incobrable.`);
  return L.join("\n");
}

/** Vuelca el resumen a un texto compacto y legible para el modelo (contexto). */
export function resumenComoTexto(r: ResumenFinanciero): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const L: string[] = [];
  L.push(`FOTO DE LA OPERACIÓN (moneda: pesos uruguayos, UYU).`);
  L.push("");
  const utilidadProy = Math.max(0, r.cartera.conIntereses - r.cartera.capitalColocado);
  const margen = r.cartera.capitalColocado > 0 ? utilidadProy / r.cartera.capitalColocado : 0;
  L.push(`CARTERA (estado contable de la cartera activa):`);
  L.push(`- Capital colocado (lo prestado, activo): ${UYU(r.cartera.capitalColocado)}`);
  L.push(`- Total a cobrar con interés (venta bruta): ${UYU(r.cartera.conIntereses)}`);
  L.push(`- Utilidad/interés PROYECTADO (si todos pagan): ${UYU(utilidadProy)} → margen ${pct(margen)} sobre el capital`);
  L.push(`- Recaudado acumulado de la cartera activa: ${UYU(r.cartera.recaudadoAcumulado)}`);
  L.push(`- Cartera por cobrar (saldo pendiente hoy): ${UYU(r.cartera.carteraPorCobrar)}`);
  L.push(`- Vence hoy y aún sin saldar: ${UYU(r.cartera.porCobrarHoy)}`);
  L.push(`- Créditos activos: ${r.cartera.creditosActivos} · deudores con crédito activo: ${r.cartera.deudoresActivos} · clientes registrados: ${r.cartera.clientesActivos}`);
  L.push(`- Créditos finalizados: ${r.cartera.creditosFinalizados} · incobrables: ${r.cartera.incobrables}`);
  L.push("");
  L.push(`RECAUDACIÓN:`);
  L.push(`- Hoy: ${UYU(r.recaudacion.hoy)} · Este mes: ${UYU(r.recaudacion.mes)}`);
  L.push("");
  L.push(`MORA:`);
  L.push(`- Monto en mora: ${UYU(r.mora.monto)} (${pct(r.mora.moraPct)} de la cartera por cobrar)`);
  L.push(`- Créditos morosos (en término): ${r.mora.morosos} · en estado crítico: ${r.mora.criticos}`);
  for (const t of r.mora.tramos)
    L.push(`  · ${t.tramo}: ${t.creditos} crédito(s), ${UYU(t.monto)}`);
  if (r.mora.vencidosCreditos > 0)
    L.push(`- Cartera VENCIDA (plazo terminado e impaga — deuda de castigo, NO mora del día): ${UYU(r.mora.carteraVencida)} en ${r.mora.vencidosCreditos} crédito(s)`);
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

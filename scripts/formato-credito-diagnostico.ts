// ─────────────────────────────────────────────────────────────────────────
//  DIAGNÓSTICO — créditos cuyo FORMATO (diario/semanal/…) no coincide con la
//  realidad. NO corrige nada: deja un listado para revisión humana.
//
//  POR QUÉ EXISTE. Hasta hoy, "Nueva venta" no dejaba elegir el formato: el
//  crédito heredaba el del anterior y el PRIMER crédito nacía "diario" a la
//  fuerza (ColocarLista.tsx / colocar.ts). Una cobradora que trabaja SEMANAL
//  cargaba 5 cuotas y el sistema las programaba para 5 días seguidos: al sexto
//  día el cartón daba todo por vencido, la ruta lo mostraba como "cartera
//  vencida" y el scoring castigaba al cliente que en realidad venía al día.
//
//  CÓMO DECIDE — y por qué NO alcanza con mirar cómo paga la gente.
//
//  ⚠️ La primera versión de este script marcó 338 créditos usando el espaciado
//  entre pagos ("paga cada 13 días → es quincenal"). Estaba MAL: en la calle
//  casi todos pagan tarde, y pagar tarde es MORA, no un formato equivocado.
//  Entre esos 338 estaba ANGELICA GOMEZ, $1.400.000 en 35 cuotas semanales de
//  $40.000 — estructura perfecta de semanal, con 3 cuotas de atraso real.
//  "Corregirla" a quincenal le habría borrado $120.000 de mora legítima. El
//  espaciado NO puede, solo, mover un formato.
//
//  Por eso el filtro de entrada es una ANOMALÍA ESTRUCTURAL: que la cuota sea
//  imposible para el formato que tiene. Con 20% de interés total, la cuota es
//  ≈ 1,2 / cantidad de cuotas del capital. Entonces:
//    · Un crédito "diario" de ≤8 cuotas con cuota ≥20% del capital se liquida
//      en menos de 8 días cobrando un quinto del capital por día: eso no es
//      cobro diario, es un plan SEMANAL (o quincenal) cargado como diario.
//  El espaciado de pagos entra DESPUÉS, y solo para dos cosas: confirmar (sube
//  la confianza) o DESMENTIR (si el cliente paga cada 1-2 días, era diario de
//  verdad y el crédito se descarta). El contexto —qué formato usan los otros
//  créditos de ese cliente y del cobrador— elige entre semanal y quincenal.
//
//  El cartón, las fechas de vencimiento y la mora NO se guardan: se DERIVAN de
//  (fecha_inicio, frecuencia, total_dias) — por eso este script importa las
//  funciones REALES (cartones.ts) en vez de reescribir el cálculo, y por eso
//  corregir `frecuencia` recalcula todo solo.
//
//  Uso:  npx tsx scripts/formato-credito-diagnostico.ts
//  Salidas: consola + scripts/_formato-credito-candidatos.json (para aprobar)
//           + scripts/_formato-credito-candidatos.csv (para revisar con la oficina)
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { cuotasDebidasHasta, plazoVencido, fechaDeCuota } from "../lib/cartones";
import { parseFecha, toIso } from "../lib/format";
import type { FrecuenciaPrestamo } from "../types/db";

// ── Conexión (service_role: solo lectura en este script) ───────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Día UY (corte 03:00 UTC) de un timestamp. */
const diaUY = (iso: string): string =>
  new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");

/** PostgREST corta a 1000 filas EN SILENCIO: todo lo grande va paginado. */
async function traerTodo<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const PASO = 1000;
  const out: T[] = [];
  for (let desde = 0; ; desde += PASO) {
    const { data, error } = await consulta(desde, desde + PASO - 1);
    if (error) throw error;
    const filas = data ?? [];
    out.push(...filas);
    if (filas.length < PASO) return out;
  }
}

interface Prestamo {
  id: string; cliente_id: string; cobrador_id: string | null;
  monto_prestado: number; cuota_diaria: number; total_dias: number;
  frecuencia: FrecuenciaPrestamo | null; fecha_inicio: string;
  origen: string | null; creado_en: string; creado_por: string | null;
}

const PASO_DIAS: Record<FrecuenciaPrestamo, number> = { diario: 1, semanal: 7, quincenal: 15, mensual: 30 };

/** Frecuencia cuyo paso se parece más al espaciado medido (en días). */
function frecuenciaDeEspaciado(dias: number): FrecuenciaPrestamo | null {
  if (dias <= 0) return null;
  if (dias <= 3.5) return "diario";
  if (dias <= 10.5) return "semanal";
  if (dias <= 21) return "quincenal";
  if (dias <= 45) return "mensual";
  return null;
}

/** Mediana (robusta ante un pago suelto raro). */
function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const hoy = new Date();

  const prestamos = await traerTodo<Prestamo>((d, h) =>
    db.from("prestamos")
      .select("id, cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, frecuencia, fecha_inicio, origen, creado_en, creado_por")
      .eq("estado", "activo")
      .order("id", { ascending: true })
      .range(d, h),
  );

  const pagos = await traerTodo<{ prestamo_id: string; registrado_en: string; monto: number }>((d, h) =>
    db.from("pagos")
      .select("prestamo_id, registrado_en, monto")
      .eq("anulado", false)
      .order("id", { ascending: true })
      .range(d, h),
  );

  const pagosDe = new Map<string, string[]>(); // prestamo → fechas (día UY) ordenadas
  const pagadoDe = new Map<string, number>();
  for (const p of pagos) {
    if (!pagosDe.has(p.prestamo_id)) pagosDe.set(p.prestamo_id, []);
    pagosDe.get(p.prestamo_id)!.push(diaUY(p.registrado_en));
    pagadoDe.set(p.prestamo_id, (pagadoDe.get(p.prestamo_id) ?? 0) + Math.round(Number(p.monto) || 0));
  }
  for (const v of pagosDe.values()) v.sort();

  // Contexto: qué formato usa cada cliente en sus OTROS créditos, y cada cobrador.
  const frecCliente = new Map<string, Map<string, number>>();
  const frecCobrador = new Map<string, Map<string, number>>();
  const sumar = (m: Map<string, Map<string, number>>, k: string | null, f: string) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Map());
    const c = m.get(k)!;
    c.set(f, (c.get(f) ?? 0) + 1);
  };
  for (const p of prestamos) {
    const f = p.frecuencia ?? "diario";
    sumar(frecCliente, p.cliente_id, f);
    sumar(frecCobrador, p.cobrador_id, f);
  }
  const dominante = (m: Map<string, number> | undefined): string | null => {
    if (!m) return null;
    let mejor: string | null = null, n = 0;
    for (const [k, v] of m) if (v > n) { mejor = k; n = v; }
    return mejor;
  };

  const nombres = new Map<string, string>();
  const ids = [...new Set(prestamos.flatMap((p) => [p.cliente_id, p.cobrador_id].filter(Boolean) as string[]))];
  for (let i = 0; i < ids.length; i += 200) {
    const tanda = ids.slice(i, i + 200);
    const [{ data: cls }, { data: us }] = await Promise.all([
      db.from("clientes").select("id, nombre").in("id", tanda),
      db.from("usuarios").select("id, nombre").in("id", tanda),
    ]);
    for (const c of cls ?? []) nombres.set(c.id as string, c.nombre as string);
    for (const u of us ?? []) nombres.set(u.id as string, u.nombre as string);
  }

  const candidatos: Record<string, unknown>[] = [];
  /** Créditos con estructura SANA cuyo cliente paga espaciado: eso es MORA, y
   *  se cuenta aparte para dejar dicho que no se ignoraron, se descartaron. */
  let irregulares = 0;
  /** Cuota pesada PERO paga a diario: era diario de verdad. No se toca. */
  let desmentidos = 0;

  for (const p of prestamos) {
    const frecActual = (p.frecuencia ?? "diario") as FrecuenciaPrestamo;
    const capital = Math.round(Number(p.monto_prestado) || 0);
    const cuota = Math.round(Number(p.cuota_diaria) || 0);
    const cuotas = Number(p.total_dias) || 0;
    if (capital <= 0 || cuota <= 0 || cuotas <= 0) continue;
    const ratio = cuota / capital;

    // ── Señal 1: espaciado REAL entre pagos ──────────────────────────────
    const fechas = pagosDe.get(p.id) ?? [];
    const unicas = [...new Set(fechas)];
    const difs: number[] = [];
    for (let i = 1; i < unicas.length; i++) {
      difs.push((parseFecha(unicas[i]).getTime() - parseFecha(unicas[i - 1]).getTime()) / 86_400_000);
    }
    const espaciado = mediana(difs);
    const frecPorPagos = difs.length >= 1 ? frecuenciaDeEspaciado(espaciado) : null;

    // ── FILTRO DE ENTRADA: anomalía ESTRUCTURAL ──────────────────────────
    //  La cuota es imposible para el formato que el crédito dice tener. Es la
    //  huella exacta del bug de "Nueva venta": plan semanal cargado como diario.
    //  Sin esto entraban 300 morosos legítimos (ver cabecera).
    const cuotaPesada = frecActual === "diario" && cuotas <= 8 && ratio >= 0.2;
    if (!cuotaPesada) {
      if (frecPorPagos != null && frecPorPagos !== frecActual) irregulares++;
      continue;
    }

    // ── Contexto: qué formato usan de verdad este cliente y este cobrador ──
    const ctxCliente = dominante(frecCliente.get(p.cliente_id));
    const ctxCobrador = dominante(frecCobrador.get(p.cobrador_id ?? ""));

    // ── DESMENTIDO: si paga cada 1-2 días, era diario de verdad. No se toca. ──
    if (frecPorPagos === "diario" && difs.length >= 2) {
      desmentidos++;
      continue;
    }

    // ── Formato inferido + confianza ─────────────────────────────────────
    //  El "cuánto" (cuotas) no cambia: cambia el PASO entre cuotas. Se elige
    //  entre semanal/quincenal/mensual con la evidencia disponible.
    let inferido: FrecuenciaPrestamo;
    let confianza: "alta" | "media" | "baja";
    let porque = `cuota = ${Math.round(ratio * 100)}% del capital en ${cuotas} cuota${cuotas === 1 ? "" : "s"} "diarias"`;
    if (frecPorPagos && frecPorPagos !== "diario" && difs.length >= 2) {
      inferido = frecPorPagos; confianza = "alta";
      porque += ` · y paga cada ~${espaciado.toFixed(0)} días (${difs.length + 1} pagos) = ${frecPorPagos}`;
    } else if (frecPorPagos && frecPorPagos !== "diario") {
      inferido = frecPorPagos; confianza = "media";
      porque += ` · su único intervalo medido es de ~${espaciado.toFixed(0)} días = ${frecPorPagos}`;
    } else {
      // Sin evidencia de pagos: manda el contexto, y queda para confirmar con
      // el cobrador. Un crédito de UNA cuota no dice nada del paso: baja siempre.
      const ctx = (ctxCliente !== "diario" ? ctxCliente : null) ?? (ctxCobrador !== "diario" ? ctxCobrador : null);
      inferido = (ctx as FrecuenciaPrestamo | null) ?? "semanal";
      confianza = "baja";
      porque += ctx
        ? ` · el cliente/cobrador trabaja ${ctx}`
        : unicas.length === 0
          ? " · sin pagos todavía: hay que preguntarle al cobrador"
          : " · con un solo pago no se puede medir el ritmo: preguntarle al cobrador";
    }
    if (inferido === frecActual) continue;

    // ── Estado de mora AHORA y DESPUÉS de corregir (motor real) ──────────
    const calc = (frec: FrecuenciaPrestamo) => {
      const pc = { fecha_inicio: p.fecha_inicio, total_dias: cuotas, cuota_diaria: cuota, frecuencia: frec };
      const debidas = cuotasDebidasHasta(pc, hoy);
      const pagado = pagadoDe.get(p.id) ?? 0;
      const cubiertas = Math.min(cuotas, Math.floor(pagado / cuota));
      return {
        debidas,
        atrasadas: Math.max(0, debidas - cubiertas),
        atrasoPesos: Math.max(0, debidas * cuota - pagado),
        vencido: plazoVencido(pc, hoy),
        ultimaCuota: toIso(fechaDeCuota(parseFecha(p.fecha_inicio), cuotas - 1, frec)),
      };
    };
    const antes = calc(frecActual);
    const despues = calc(inferido);

    candidatos.push({
      prestamoId: p.id,
      cliente: nombres.get(p.cliente_id) ?? "?",
      cobrador: nombres.get(p.cobrador_id ?? "") ?? "(sin cobrador)",
      capital, cuota, cuotas,
      ratioCuotaPct: Math.round(ratio * 100),
      formatoActual: frecActual,
      formatoInferido: inferido,
      confianza,
      porque,
      fechaInicio: p.fecha_inicio,
      pagos: unicas.length,
      pagado: pagadoDe.get(p.id) ?? 0,
      espaciadoDias: difs.length ? Number(espaciado.toFixed(1)) : null,
      origen: p.origen ?? "credito",
      moraAntes: antes,
      moraDespues: despues,
    });
  }

  // ── Salida ────────────────────────────────────────────────────────────
  candidatos.sort((a, b) => {
    const orden = { alta: 0, media: 1, baja: 2 } as Record<string, number>;
    return orden[a.confianza as string] - orden[b.confianza as string] ||
      (b.capital as number) - (a.capital as number);
  });

  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log(`  CRÉDITOS CON FORMATO SOSPECHOSO — ${candidatos.length} de ${prestamos.length} activos`);
  console.log("══════════════════════════════════════════════════════════════════════════\n");

  for (const c of candidatos) {
    const a = c.moraAntes as ReturnType<typeof calcTipo>;
    const d = c.moraDespues as ReturnType<typeof calcTipo>;
    console.log(`[${String(c.confianza).toUpperCase()}] ${c.cliente}  ·  cobrador: ${c.cobrador}`);
    console.log(`   ${UYU(c.capital as number)} en ${c.cuotas} cuotas de ${UYU(c.cuota as number)} (${c.ratioCuotaPct}% del capital) · desde ${c.fechaInicio}`);
    console.log(`   formato: ${c.formatoActual}  →  ${c.formatoInferido}      porque ${c.porque}`);
    console.log(`   pagos registrados: ${c.pagos}${c.espaciadoDias ? ` · cada ~${c.espaciadoDias} días` : ""} · pagado ${UYU(c.pagado as number)}`);
    console.log(`   MORA hoy:    ${a.atrasadas} cuota(s) atrasada(s) · ${UYU(a.atrasoPesos)} · ${a.vencido ? "PLAZO VENCIDO" : "en plazo"} (última cuota ${a.ultimaCuota})`);
    console.log(`   MORA si se corrige: ${d.atrasadas} cuota(s) · ${UYU(d.atrasoPesos)} · ${d.vencido ? "PLAZO VENCIDO" : "en plazo"} (última cuota ${d.ultimaCuota})`);
    console.log("");
  }

  const porConfianza = (n: string) => candidatos.filter((c) => c.confianza === n).length;
  console.log("──────────────────────────────────────────────────────────────────────────");
  console.log(`  alta: ${porConfianza("alta")}   media: ${porConfianza("media")}   baja: ${porConfianza("baja")}`);
  console.log(`  Dejan de figurar vencidos si se corrigen: ${candidatos.filter((c) => (c.moraAntes as { vencido: boolean }).vencido && !(c.moraDespues as { vencido: boolean }).vencido).length}`);
  console.log("");
  console.log(`  NO tocados a propósito:`);
  console.log(`   · ${irregulares} créditos con estructura sana cuyo cliente paga espaciado`);
  console.log(`     → eso es MORA REAL, no formato mal cargado. Tocarlos borraría atraso.`);
  console.log(`   · ${desmentidos} con cuota pesada pero que SÍ pagan a diario (era diario de verdad).`);
  console.log("──────────────────────────────────────────────────────────────────────────\n");

  const salida = new URL("./_formato-credito-candidatos.json", import.meta.url);
  writeFileSync(salida, JSON.stringify({ generado: new Date().toISOString(), candidatos }, null, 2), "utf8");
  const csv = [
    "prestamo_id;cliente;cobrador;capital;cuota;cuotas;pct_cuota;formato_actual;formato_inferido;confianza;porque;pagos;espaciado_dias;atrasadas_hoy;atrasadas_si_corrige;aprobar",
    ...candidatos.map((c) =>
      [c.prestamoId, c.cliente, c.cobrador, c.capital, c.cuota, c.cuotas, c.ratioCuotaPct, c.formatoActual,
       c.formatoInferido, c.confianza, c.porque, c.pagos, c.espaciadoDias ?? "",
       (c.moraAntes as { atrasadas: number }).atrasadas, (c.moraDespues as { atrasadas: number }).atrasadas, ""]
        .map((v) => String(v ?? "").replace(/;/g, ",")).join(";"),
    ),
  ].join("\n");
  writeFileSync(new URL("./_formato-credito-candidatos.csv", import.meta.url), "﻿" + csv, "utf8");
  console.log(`Listado para revisión: scripts/_formato-credito-candidatos.json (+ .csv)`);
  console.log(`Para corregir los aprobados:  npx tsx scripts/formato-credito-corregir.ts --commit\n`);
}

// Solo para tipar la salida de `calc` en el print.
declare function calcTipo(): { debidas: number; atrasadas: number; atrasoPesos: number; vencido: boolean; ultimaCuota: string };

main().catch((e) => {
  console.error("Falló el diagnóstico:", e);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────
//  CORRECCIÓN del FORMATO de créditos ya cargados — con rastro en el libro.
//
//  Corre SOLO sobre los créditos APROBADOS a mano. Nada automático: la lista
//  sale de `formato-credito-diagnostico.ts` y hay que marcar cuáles se aprueban.
//
//  QUÉ CAMBIA Y QUÉ NO:
//   · Cambia UNA cosa: `prestamos.frecuencia` (el PASO entre cuotas).
//   · NO toca los pagos (el libro es inmutable), ni el capital, ni la cuota, ni
//     la cantidad de cuotas, ni el interés. El cliente debe exactamente lo mismo.
//   · NO hace falta "recalcular" el calendario ni la mora: en este sistema no se
//     guardan. El cartón, las fechas de vencimiento, el atraso y el scoring se
//     DERIVAN de (fecha_inicio, frecuencia, total_dias) cada vez que se miran
//     (lib/cartones.ts, lib/scoring.ts). Al cambiar la frecuencia, todo eso queda
//     recalculado solo, en la misma consulta. Este script lo VERIFICA después de
//     escribir, con las funciones reales, y reporta el antes/después.
//
//  RASTRO (no negociable): cada corrección deja una entrada en `auditoria`
//  —el log inmutable— con acción "Corrección administrativa: formato de crédito",
//  el responsable, el motivo y el antes/después. Ningún UPDATE en silencio.
//
//  Uso:
//    npx tsx scripts/formato-credito-corregir.ts                 → ENSAYO (no escribe)
//    npx tsx scripts/formato-credito-corregir.ts --commit        → aplica
//    ... --responsable "Carlos" --motivo "Revisado con María, son semanales"
//
//  Aprobación: en `_formato-credito-candidatos.json`, poner "aprobado": true en
//  cada crédito que SÍ se corrige (o pasar --aprobar-confianza alta,media).
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { cuotasDebidasHasta, plazoVencido, fechaDeCuota } from "../lib/cartones";
import { parseFecha, toIso } from "../lib/format";
import type { FrecuenciaPrestamo } from "../types/db";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const valor = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
// ⚠️ Sin --responsable NO se firma con el nombre del dueño: el libro es
// inmutable y atribuirle a alguien una corrección que no hizo es peor que un
// dato faltante. Se exige el nombre para aplicar (ver más abajo).
const RESPONSABLE = valor("--responsable", "");
const MOTIVO = valor("--motivo", "Crédito cargado con formato equivocado: 'Nueva venta' no dejaba elegirlo.");
const APROBAR_CONFIANZA = valor("--aprobar-confianza", "").split(",").map((s) => s.trim()).filter(Boolean);

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const FRECUENCIAS: FrecuenciaPrestamo[] = ["diario", "semanal", "quincenal", "mensual"];

interface Candidato {
  prestamoId: string; cliente: string; cobrador: string;
  capital: number; cuota: number; cuotas: number;
  formatoActual: FrecuenciaPrestamo; formatoInferido: FrecuenciaPrestamo;
  confianza: string; porque: string; fechaInicio: string;
  aprobado?: boolean;
}

async function main() {
  const ruta = new URL("./_formato-credito-candidatos.json", import.meta.url);
  const { candidatos } = JSON.parse(readFileSync(ruta, "utf8")) as { candidatos: Candidato[] };

  const aprobados = candidatos.filter(
    (c) => c.aprobado === true || (APROBAR_CONFIANZA.length > 0 && APROBAR_CONFIANZA.includes(c.confianza)),
  );

  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log(`  CORRECCIÓN DE FORMATO — ${COMMIT ? "APLICANDO" : "ENSAYO (no escribe nada)"}`);
  console.log(`  Aprobados: ${aprobados.length} de ${candidatos.length} candidatos`);
  console.log(`  Responsable: ${RESPONSABLE || "(falta --responsable)"}`);
  console.log("══════════════════════════════════════════════════════════════════════════\n");

  if (COMMIT && !RESPONSABLE.trim()) {
    console.log("Falta --responsable \"Nombre de quien autoriza\": el libro es inmutable y la");
    console.log("corrección tiene que quedar firmada por una persona, no por un default.\n");
    return;
  }

  if (aprobados.length === 0) {
    console.log("No hay créditos aprobados. Marcá \"aprobado\": true en el JSON,");
    console.log("o pasá --aprobar-confianza alta,media para aprobar por nivel de certeza.\n");
    return;
  }

  const hoy = new Date();
  const hechos: Record<string, unknown>[] = [];

  for (const c of aprobados) {
    if (!FRECUENCIAS.includes(c.formatoInferido)) {
      console.log(`  ⚠️  ${c.cliente}: formato inválido "${c.formatoInferido}" — se saltea.`);
      continue;
    }

    // Se relee el crédito ANTES de tocarlo: el listado puede tener horas y el
    // crédito pudo cambiar (renovado, cancelado, ya corregido por otro).
    const { data: actual, error: eLee } = await db
      .from("prestamos")
      .select("id, estado, frecuencia, fecha_inicio, total_dias, cuota_diaria, monto_prestado, cliente_id")
      .eq("id", c.prestamoId)
      .maybeSingle();
    if (eLee) throw eLee;
    if (!actual) { console.log(`  ⚠️  ${c.cliente}: el crédito ya no existe — se saltea.`); continue; }
    if (actual.estado !== "activo") { console.log(`  ⚠️  ${c.cliente}: ya no está activo (${actual.estado}) — se saltea.`); continue; }
    if (actual.frecuencia !== c.formatoActual) {
      console.log(`  ⚠️  ${c.cliente}: el formato ya cambió (${actual.frecuencia}) — se saltea.`);
      continue;
    }

    // Antes/después con el motor REAL (mismo cálculo que ven las pantallas).
    const pc = (frec: FrecuenciaPrestamo) => ({
      fecha_inicio: actual.fecha_inicio as string,
      total_dias: Number(actual.total_dias),
      cuota_diaria: Number(actual.cuota_diaria),
      frecuencia: frec,
    });
    const foto = (frec: FrecuenciaPrestamo) => ({
      debidas: cuotasDebidasHasta(pc(frec), hoy),
      vencido: plazoVencido(pc(frec), hoy),
      ultimaCuota: toIso(fechaDeCuota(parseFecha(actual.fecha_inicio as string), Number(actual.total_dias) - 1, frec)),
    });
    const antes = foto(c.formatoActual);
    const despues = foto(c.formatoInferido);

    console.log(`  ${c.cliente} (${c.cobrador})`);
    console.log(`     ${UYU(c.capital)} · ${c.cuotas} cuotas de ${UYU(c.cuota)} · ${c.formatoActual} → ${c.formatoInferido}  [${c.confianza}]`);
    console.log(`     vence: ${antes.ultimaCuota} → ${despues.ultimaCuota}   ·   cuotas exigibles hoy: ${antes.debidas} → ${despues.debidas}`);

    if (COMMIT) {
      // 1) El cambio: SOLO la frecuencia. El libro de pagos no se toca.
      // ⚠️ `.select("id")` para saber CUÁNTAS filas tocó: un UPDATE que afecta 0
      // filas NO es un error en PostgREST, y sin esto se escribía en el libro el
      // rastro de una corrección que nunca ocurrió (el candado optimista pudo
      // haber perdido la carrera contra una renovación).
      const { data: tocadas, error: eUpd } = await db
        .from("prestamos")
        .update({ frecuencia: c.formatoInferido, actualizado_en: new Date().toISOString() })
        .eq("id", c.prestamoId)
        .eq("estado", "activo")
        .eq("frecuencia", c.formatoActual) // candado optimista: nadie lo cambió en el medio
        .select("id");
      if (eUpd) { console.log(`     ❌ no se pudo: ${eUpd.message}`); continue; }
      if ((tocadas ?? []).length === 0) {
        console.log("     ⚠️  no se tocó ninguna fila (cambió en el medio): sin cambio y SIN rastro.");
        continue;
      }

      // 2) El rastro, en el log inmutable. Si esto falla, se avisa fuerte: un
      //    cambio de datos sin su registro es exactamente lo que no puede pasar.
      const detalle =
        `${c.formatoActual} → ${c.formatoInferido} · ${UYU(c.capital)} en ${c.cuotas} cuotas de ${UYU(c.cuota)} · ` +
        `vencimiento ${antes.ultimaCuota} → ${despues.ultimaCuota} · cuotas exigibles hoy ${antes.debidas} → ${despues.debidas} · ` +
        `evidencia: ${c.porque} (confianza ${c.confianza}) · motivo: ${MOTIVO}`;
      const { error: eAud } = await db.from("auditoria").insert({
        actor_id: null,
        actor_nombre: `${RESPONSABLE} (corrección administrativa)`,
        accion: "Corrección administrativa: formato de crédito",
        entidad: "prestamo",
        entidad_id: c.prestamoId,
        detalle: detalle.slice(0, 1000),
      });
      if (eAud) console.log(`     ⚠️  CAMBIO APLICADO PERO SIN RASTRO EN AUDITORÍA: ${eAud.message}`);
      else console.log(`     ✓ corregido y registrado en el libro`);
    }

    hechos.push({
      prestamoId: c.prestamoId, cliente: c.cliente, cobrador: c.cobrador,
      de: c.formatoActual, a: c.formatoInferido, confianza: c.confianza,
      venceAntes: antes.ultimaCuota, venceDespues: despues.ultimaCuota,
      exigiblesAntes: antes.debidas, exigiblesDespues: despues.debidas,
      dejaDeEstarVencido: antes.vencido && !despues.vencido,
    });
    console.log("");
  }

  const salen = hechos.filter((h) => h.dejaDeEstarVencido).length;
  console.log("──────────────────────────────────────────────────────────────────────────");
  console.log(`  ${COMMIT ? "Corregidos" : "Se corregirían"}: ${hechos.length}`);
  console.log(`  Dejan de figurar con el plazo vencido: ${salen}`);
  console.log(`  El scoring y la mora se recalculan solos (se derivan, no se guardan).`);
  console.log("──────────────────────────────────────────────────────────────────────────\n");

  // ⚠️ El ENSAYO escribe su propio archivo: pisar `_aplicado.json` borraba la
  // REVERSA de las correcciones que sí se hicieron (el antes/después de cada
  // crédito), y ese archivo es lo que permite volver atrás sin adivinar.
  writeFileSync(
    new URL(COMMIT ? "./_formato-credito-aplicado.json" : "./_formato-credito-ensayo.json", import.meta.url),
    JSON.stringify({ cuando: new Date().toISOString(), aplicado: COMMIT, responsable: RESPONSABLE, motivo: MOTIVO, hechos }, null, 2),
    "utf8",
  );
  if (!COMMIT) console.log("Fue un ENSAYO. Para aplicarlo de verdad, agregá --commit\n");
}

main().catch((e) => {
  console.error("Falló la corrección:", e);
  process.exit(1);
});

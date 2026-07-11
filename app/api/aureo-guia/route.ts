// ─────────────────────────────────────────────────────────────────────────
//  "Aureo ve hoy" REAL: guía del día generada por IA (DeepSeek, one-shot), a
//  medida de CADA gestor y ACOTADA A SU ZONA. Se pide async desde el dashboard
//  (no lo frena) y se CACHEA por gestor+día (una llamada por persona por día).
//  Si falta la API key o falla, degrada a una guía derivada de las reglas
//  (nunca rompe ni deja la sección vacía).
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenFinanciero, resumenComoTexto, type ResumenFinanciero } from "@/lib/data/asesor";
import { generarInsights } from "@/lib/insights";
import { MODELO_ASESOR, TEMPERATURA_ASESOR } from "@/lib/asesor/prompt";
import { fechaISOUY } from "@/lib/fecha";

export const dynamic = "force-dynamic";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

type Guia = { guia: string; tono: "critico" | "alerta" | "bueno" | "neutro"; fuente: "aureo" | "reglas" };

// Cache en memoria por (gestor, día UY). Sobrevive mientras la instancia esté
// caliente → DeepSeek se llama a lo sumo una vez por persona por día por instancia.
const cache = new Map<string, Guia>();

function tonoDe(r: ResumenFinanciero): Guia["tono"] {
  if (r.mora.criticos > 0) return "critico";
  if (r.mora.moraPct >= 0.15) return "alerta";
  return "bueno";
}

/** Guía de respaldo (sin IA): arma un texto corto desde las reglas deterministas. */
function guiaPorReglas(r: ResumenFinanciero): string {
  const ins = generarInsights({
    moraPct: r.mora.moraPct,
    montoEnMora: r.mora.monto,
    morosos: r.mora.morosos,
    criticos: r.mora.criticos,
    carteraPorCobrar: r.cartera.carteraPorCobrar,
    recaudadoHoy: r.recaudacion.hoy,
    recaudadoMes: r.recaudacion.mes,
    topRiesgo: r.mora.topRiesgo,
    cobradores: r.cobradores.ranking,
    alertas: r.cobradores.alertas,
    serie: { promedio: 0, hoy: 0, tendencia: 0 },
  }, 2);
  if (ins.length === 0) return "Todo en orden hoy: sin mora crítica ni anomalías. Sostené el ritmo de cobranza y cuidá el capital.";
  return ins.map((i) => i.detalle).join(" ");
}

async function guiaPorIA(r: ResumenFinanciero, rol: string): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const marco =
    rol === "admin"
      ? "Sos Aureo, asesor de Presta Ya. Le hablás al DUEÑO sobre TODA la operación."
      : "Sos Aureo, asesor de Presta Ya. Le hablás a un SUPERVISOR sobre SU zona (solo sus cobradores y clientes).";
  const system = `${marco}
Escribí LA GUÍA DEL DÍA en 2 a 4 frases, en español rioplatense (tratá de "vos"), TEXTO PLANO sin markdown ni viñetas ni encabezados. Decí: la prioridad #1 de hoy, el número real que la respalda, y la acción concreta a hacer YA. Sé específico y directo, sin relleno. Basate SOLO en la foto de abajo; no inventes cifras.

${resumenComoTexto(r)}`;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODELO_ASESOR,
        temperature: TEMPERATURA_ASESOR,
        max_tokens: 260,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Dame la guía del día para hoy." },
        ],
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = json.choices?.[0]?.message?.content?.trim();
    return texto && texto.length > 0 ? texto : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const clave = `${usuario.id}:${fechaISOUY()}`;
  const cacheada = cache.get(clave);
  if (cacheada) return NextResponse.json(cacheada);

  const db = await createSupabaseServer();
  const resumen = await getResumenFinanciero(db); // ya viene acotado a la zona del gestor
  const tono = tonoDe(resumen);

  const texto = await guiaPorIA(resumen, usuario.rol);
  const guia: Guia = texto
    ? { guia: texto, tono, fuente: "aureo" }
    : { guia: guiaPorReglas(resumen), tono, fuente: "reglas" };

  cache.set(clave, guia);
  return NextResponse.json(guia);
}

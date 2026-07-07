// ─────────────────────────────────────────────────────────────────────────
//  Route handler del ASESOR IA (streaming). Solo gestores. Arma la foto real
//  del negocio, la inyecta como contexto y transmite la respuesta de DeepSeek
//  token a token. La API key vive SOLO acá (servidor).
//
//  Dos modos (modelos V4; deepseek-chat/reasoner se deprecaron 2026-07-24):
//   · rápido   → deepseek-v4-flash + herramientas (function calling). Si pide una
//     herramienta, la ejecutamos contra la base y seguimos.
//   · profundo → deepseek-v4-pro (más capaz) para preguntas estratégicas (sin tools).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import {
  getResumenFinanciero,
  resumenComoTexto,
  buscarClientePerfil,
  rutaCobradorTexto,
  proyeccionCajaTexto,
  tableroMoraTexto,
  rankingCobradoresTexto,
  tendenciaRecaudoTexto,
} from "@/lib/data/asesor";
import {
  construirSystemPrompt,
  MODELO_ASESOR,
  MODELO_ASESOR_PROFUNDO,
  TEMPERATURA_ASESOR,
  MAX_TOKENS_ASESOR,
  MAX_TOKENS_PROFUNDO,
  herramientasPara,
  esHerramientaPermitida,
} from "@/lib/asesor/prompt";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rol } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MAX_MENSAJES = 12;
const MAX_LARGO = 2000;
const MAX_ITERACIONES = 3; // vueltas de herramientas antes de responder

interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

/** Una request de streaming a DeepSeek. Encola el texto (delta.content) y
 *  acumula las tool_calls; devuelve las herramientas pedidas + finish_reason. */
async function streamTurno(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ toolCalls: ToolAcc[]; finish: string | null }> {
  const upstream = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!upstream.ok || !upstream.body) throw new Error("upstream");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const tools = new Map<number, ToolAcc>();
  let finish: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lineas = buffer.split("\n");
    buffer = lineas.pop() ?? "";
    for (const linea of lineas) {
      const t = linea.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = (json as { choices?: { delta?: Record<string, unknown>; finish_reason?: string }[] })
        .choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta ?? {};
      // Solo el contenido final va al usuario (el reasoning_content se ignora).
      if (typeof delta.content === "string" && delta.content.length > 0) {
        controller.enqueue(encoder.encode(delta.content));
      }
      const tcs = delta.tool_calls as
        | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const idx = tc.index ?? 0;
          const cur = tools.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tools.set(idx, cur);
        }
      }
    }
  }
  return { toolCalls: [...tools.values()], finish };
}

/** Ejecuta una herramienta pedida por el modelo contra la base (como gestor). */
async function ejecutarHerramienta(
  db: SupabaseClient,
  name: string,
  argsJson: string,
  rol: Rol,
): Promise<string> {
  // Defensa en profundidad: aunque al rol no se le ofrezca la herramienta,
  // rechazamos por las dudas si igual la pidiera.
  if (!esHerramientaPermitida(rol, name))
    return "Esa información la maneja el administrador; no está disponible para tu rol.";
  let args: { nombre?: string; dias?: number } = {};
  try {
    args = JSON.parse(argsJson || "{}");
  } catch {
    /* args mal formados */
  }
  if (name === "buscar_cliente") return buscarClientePerfil(db, args.nombre ?? "");
  if (name === "ruta_cobrador") return rutaCobradorTexto(db, args.nombre ?? "");
  if (name === "proyeccion_caja") return proyeccionCajaTexto(db, args.dias ?? 30);
  if (name === "tablero_mora") return tableroMoraTexto(db);
  if (name === "ranking_cobradores") return rankingCobradoresTexto(db);
  if (name === "tendencia_recaudo") return tendenciaRecaudoTexto(db, args.dias ?? 14);
  return `Herramienta desconocida: ${name}`;
}

export async function POST(req: Request): Promise<Response> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return new Response("No autorizado.", { status: 401 });
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response("El asesor no está configurado (falta DEEPSEEK_API_KEY).", { status: 503 });
  }

  // Conversación entrante + modo.
  let historia: ChatMsg[] = [];
  let profundo = false;
  try {
    const body = (await req.json()) as { messages?: unknown; modo?: unknown };
    profundo = body.modo === "profundo";
    if (Array.isArray(body.messages)) {
      historia = body.messages
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof (m as ChatMsg).content === "string" &&
            ((m as ChatMsg).role === "user" || (m as ChatMsg).role === "assistant"),
        )
        .slice(-MAX_MENSAJES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LARGO) }));
    }
  } catch {
    return new Response("Cuerpo inválido.", { status: 400 });
  }
  if (historia.length === 0 || historia[historia.length - 1].role !== "user") {
    return new Response("Falta la consulta.", { status: 400 });
  }

  // Foto real del negocio → contexto.
  const db = await createSupabaseServer();
  let systemPrompt: string;
  try {
    const resumen = await getResumenFinanciero(db);
    systemPrompt = construirSystemPrompt(resumenComoTexto(resumen), usuario.rol);
  } catch {
    return new Response("No se pudo leer la información del negocio.", { status: 500 });
  }

  const messages: ChatMsg[] = [{ role: "system", content: systemPrompt }, ...historia];
  const model = profundo ? MODELO_ASESOR_PROFUNDO : MODELO_ASESOR;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for (let iter = 0; iter < MAX_ITERACIONES; iter++) {
          const body: Record<string, unknown> = profundo
            ? { model, messages, temperature: TEMPERATURA_ASESOR, max_tokens: MAX_TOKENS_PROFUNDO }
            : {
                model,
                messages,
                temperature: TEMPERATURA_ASESOR,
                max_tokens: MAX_TOKENS_ASESOR,
                tools: herramientasPara(usuario.rol),
                tool_choice: "auto",
              };

          const { toolCalls, finish } = await streamTurno(controller, encoder, apiKey, body);

          // Si pidió herramientas, las ejecutamos y damos otra vuelta.
          if (!profundo && finish === "tool_calls" && toolCalls.length > 0) {
            messages.push({
              role: "assistant",
              content: null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.args },
              })),
            });
            for (const tc of toolCalls) {
              const resultado = await ejecutarHerramienta(db, tc.name, tc.args, usuario.rol);
              messages.push({ role: "tool", tool_call_id: tc.id, content: resultado });
            }
            continue;
          }
          break;
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

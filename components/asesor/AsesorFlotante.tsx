"use client";
// Asesor financiero IA — chat FLOTANTE del panel admin. Botón discreto abajo a
// la derecha; abre un panel donde el gestor consulta y recibe consejo anclado
// en los datos reales del negocio (el contexto lo arma el servidor). Respuesta
// en streaming (token a token). La API key nunca toca el navegador.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const TOKEN_FICHA = /\[\[ficha:([0-9a-fA-F-]{36})\|([^\]]+)\]\]/g;

/** Separa el texto visible de los tokens [[ficha:ID|Nombre]] (→ botones). */
function parsearRespuesta(content: string): {
  texto: string;
  fichas: { id: string; nombre: string }[];
} {
  const fichas: { id: string; nombre: string }[] = [];
  let m: RegExpExecArray | null;
  TOKEN_FICHA.lastIndex = 0;
  while ((m = TOKEN_FICHA.exec(content)) !== null) {
    if (!fichas.some((f) => f.id === m![1])) fichas.push({ id: m[1], nombre: m[2].trim() });
  }
  // Quita los tokens completos y cualquier fragmento parcial en streaming.
  const texto = content.replace(TOKEN_FICHA, "").replace(/\[\[ficha:[^\]]*$/, "").trimEnd();
  return { texto, fichas };
}

const SUGERENCIAS = [
  "Resumen del día",
  "¿Cómo bajo la mora?",
  "¿A quién conviene renovar?",
  "¿Hay algún cobrador con problemas?",
];

export function AsesorFlotante() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [profundo, setProfundo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, abierto]);

  // Teclado en mobile: sin esto, el panel flotante anclado abajo queda TAPADO por
  // el teclado (no ves lo que escribís). Con VisualViewport medimos cuánto ocupa
  // el teclado y levantamos el panel SOLO lo necesario (--kb) — cómodo y portátil,
  // sin volverlo full-screen. En desktop VisualViewport no reporta teclado → 0.
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    if (!abierto || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Umbral: ignora la barra de URL (variación chica), levanta solo por el teclado.
      setKbInset(inset > 120 ? inset : 0);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, [abierto]);

  // El dashboard (u otras vistas) puede pedir abrir el asesor con una consulta
  // ya cargada vía el evento global `aureo:preguntar`. Usamos un ref para
  // tomar siempre la última versión de `preguntar` sin re-suscribir el listener.
  const preguntarRef = useRef<(q: string) => void>(() => {});
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === "string" && q.trim()) {
        setAbierto(true);
        preguntarRef.current(q);
      }
    };
    window.addEventListener("aureo:preguntar", handler);
    return () => window.removeEventListener("aureo:preguntar", handler);
  }, []);

  const preguntar = async (pregunta: string) => {
    const q = pregunta.trim();
    if (!q || cargando) return;
    setError(null);
    setTexto("");
    const historia: Msg[] = [...mensajes, { role: "user", content: q }];
    setMensajes([...historia, { role: "assistant", content: "" }]);
    setCargando(true);

    try {
      const res = await fetch("/api/asesor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historia, modo: profundo ? "profundo" : "rapido" }),
      });
      if (!res.ok || !res.body) {
        const detalle = await res.text().catch(() => "");
        throw new Error(detalle || "No se pudo consultar al asesor.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMensajes((m) => {
          const copia = [...m];
          copia[copia.length - 1] = { role: "assistant", content: acc };
          return copia;
        });
      }
      if (acc.trim() === "") throw new Error("El asesor no devolvió respuesta.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
      // Quita la burbuja vacía del asistente si falló.
      setMensajes((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m));
    } finally {
      setCargando(false);
    }
  };
  preguntarRef.current = preguntar;

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label="Asesor financiero"
        className="fixed right-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[24px] text-white shadow-[0_10px_30px_rgba(19,48,140,0.45)] transition-transform active:scale-90 max-md:bottom-[5.5rem]"
      >
        {abierto ? "✕" : "💡"}
      </button>

      {/* Panel */}
      {abierto && (
        <div
          style={{ "--kb": `${kbInset}px` } as CSSProperties}
          className="fixed right-3 bottom-[calc(0.75rem+var(--kb,0px))] z-50 flex h-[70dvh] max-h-[min(560px,calc(100dvh-var(--kb,0px)-1.25rem))] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[20px] border border-[#E6EAF4] bg-white shadow-[0_20px_60px_rgba(15,27,61,0.35)] transition-[bottom,max-height] duration-150 md:right-4 md:bottom-20 md:h-[70vh] md:max-h-[640px] md:w-[min(420px,calc(100vw-2rem))]"
        >
          {/* Encabezado */}
          <div className="flex items-center gap-2.5 border-b border-[#EEF1F8] bg-[#0F1B3D] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[18px]">
              💡
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[14px] font-extrabold text-white">Aureo · Asesor</span>
              <span className="text-[10.5px] font-medium text-white/50">
                Consejo sobre tus números reales
              </span>
            </div>
            <button
              type="button"
              onClick={() => setProfundo((v) => !v)}
              title="Análisis profundo: razona más a fondo (más lento)"
              aria-pressed={profundo}
              className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                profundo ? "bg-[#2453DC] text-white" : "bg-white/10 text-white/70"
              }`}
            >
              🧠 Profundo
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[18px] text-white/70 hover:bg-white/10 active:scale-90"
            >
              ✕
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto bg-[#F4F6FB] px-3.5 py-3">
            {mensajes.length === 0 ? (
              <div className="flex flex-col gap-3 pt-2">
                <p className="text-[13px] leading-relaxed font-medium text-gris">
                  Hola 👋 Soy tu asesor. Puedo mirar tu cartera, mora y cobranza y
                  darte consejo concreto. Probá con:
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGERENCIAS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => preguntar(s)}
                      className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[12px] font-semibold text-azul active:scale-95"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {mensajes.map((m, i) => {
                  const parsed = m.role === "assistant" ? parsearRespuesta(m.content) : null;
                  return (
                    <div
                      key={i}
                      className={`flex max-w-[88%] flex-col gap-1.5 ${m.role === "user" ? "self-end" : "self-start"}`}
                    >
                      <div
                        className={`rounded-[14px] px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-[#2453DC] text-white"
                            : "bg-white text-tinta shadow-[0_1px_2px_rgba(26,34,71,0.06)]"
                        }`}
                      >
                        {(parsed ? parsed.texto : m.content) ||
                          (m.role === "assistant" && cargando ? (
                            <span className="text-gris">
                              {profundo ? "Razonando a fondo…" : "Pensando…"}
                            </span>
                          ) : (
                            ""
                          ))}
                      </div>
                      {parsed && parsed.fichas.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {parsed.fichas.map((f) => (
                            <Link
                              key={f.id}
                              href={`/admin/clientes/${f.id}`}
                              className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1 text-[11.5px] font-bold text-azul active:scale-95"
                            >
                              📂 Abrir ficha de {f.nombre}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={finRef} />
              </div>
            )}
            {error && (
              <p className="mt-2 rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-semibold text-[#C0392B]">
                {error}
              </p>
            )}
          </div>

          {/* Entrada */}
          <div className="border-t border-[#EEF1F8] bg-white p-2.5">
            <div className="flex items-end gap-2">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    preguntar(texto);
                  }
                }}
                rows={1}
                placeholder="Preguntá algo sobre el negocio…"
                disabled={cargando}
                // text-[16px]: evita el ZOOM automático de iOS al enfocar (<16px).
                className="max-h-28 min-h-11 flex-1 resize-none rounded-[12px] border border-[#DCE3F4] px-3 py-2.5 text-[16px] outline-none focus:border-azul disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => preguntar(texto)}
                disabled={cargando || texto.trim().length === 0}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#2453DC] text-[16px] text-white transition-transform active:scale-90 disabled:opacity-40"
                aria-label="Enviar"
              >
                ➤
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] font-medium text-[#AEB6CC]">
              Orientativo. Para temas legales o impositivos, consultá a un profesional.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

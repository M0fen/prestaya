"use client";
// ─────────────────────────────────────────────────────────────────────────
//  GameSlot — espacio de juegos de alto rendimiento.
//
//  · Costo CERO hasta que el usuario toca "Jugar" (click-to-load): el iframe
//    no se monta antes. Así la vista del crédito carga instantánea.
//  · Aislamiento total: <iframe sandbox="allow-scripts"> → origen opaco, no
//    accede a cookies ni al DOM del padre. El juego no puede romper la app.
//  · Recompensa: el juego avisa con postMessage; validamos el origen por
//    referencia (event.source === iframe) y mostramos el premio.
//  · Reemplazable cada mes: el juego sale de lib/juegos (JUEGO_ACTUAL).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { JUEGO_ACTUAL } from "@/lib/juegos";

export function GameSlot() {
  const juego = JUEGO_ACTUAL;
  const [jugando, setJugando] = useState(false);
  const [premio, setPremio] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Escucha el "ganaste" del juego, validando que venga de NUESTRO iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (d && d.source === "presta-ya-game" && d.event === "win") {
        setPremio(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function cerrar() {
    setJugando(false); // desmonta el iframe → libera CPU/memoria del juego
    setPremio(false);
  }

  return (
    <section className="rounded-[22px] bg-[linear-gradient(135deg,#13308C,#1E47C8)] p-[7px] shadow-[0_12px_28px_rgba(19,48,140,0.22)]">
      <div className="overflow-hidden rounded-[17px] border-[1.5px] border-dashed border-white/[0.40]">
        {!jugando ? (
          // Póster liviano. Nada del juego se descarga hasta tocar "Jugar".
          <div className="flex flex-col items-center gap-2 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_10px,transparent_10px_20px)] px-5 py-7 text-center">
            <span className="text-[11px] font-extrabold tracking-[0.14em] text-white/[0.72] uppercase">
              Juego del mes
            </span>
            <span className="text-[19px] font-extrabold tracking-[-0.02em] text-white">
              {juego.titulo}
            </span>
            <span className="max-w-[250px] text-[12.5px] leading-[1.45] font-medium text-white/[0.66]">
              {juego.descripcion}
            </span>
            <button
              type="button"
              onClick={() => setJugando(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-[14px] font-extrabold text-[#13308C] transition-transform active:scale-95"
            >
              <span aria-hidden="true">▶</span> Jugar
            </button>
          </div>
        ) : (
          <div className="relative">
            <iframe
              ref={iframeRef}
              src={juego.ruta}
              title={juego.titulo}
              loading="lazy"
              sandbox="allow-scripts"
              className="block w-full"
              style={{ height: juego.alto, border: 0 }}
            />

            {/* Cerrar: desmonta el juego y libera recursos. */}
            <button
              type="button"
              onClick={cerrar}
              aria-label="Cerrar juego"
              className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-[14px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-black/55"
            >
              ✕
            </button>

            {premio && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[linear-gradient(90deg,#1FA971,#157A50)] px-4 py-3 text-white">
                <span className="text-[13px] font-bold">
                  🎉 ¡Premio del mes desbloqueado!
                </span>
                <button
                  type="button"
                  onClick={() => setPremio(false)}
                  className="rounded-full bg-white/20 px-3 py-1 text-[12px] font-bold"
                >
                  Listo
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

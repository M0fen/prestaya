"use client";
// Aviso rápido a un cobrador desde "Mi jornada" (En vivo / Necesitan atención).
// Publica en el HILO del cobrador (canal "cob:<id>") reusando la acción de chat.
// El supervisor no sale de la jornada para mandar la indicación.
import { useState, useTransition } from "react";
import { enviarMensaje } from "@/lib/acciones/chat";

const SUGERENCIAS = ["¿Cómo venís con la ruta?", "Pasá por los atrasados primero.", "Rendí antes de las 18h."];

export function AvisarCobrador({ cobradorId, nombre }: { cobradorId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function enviar(cuerpo: string) {
    const c = cuerpo.trim();
    if (!c) {
      setError("Escribí el mensaje.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await enviarMensaje({ canal: `cob:${cobradorId}`, cuerpo: c });
      if (!r.ok) setError(r.error);
      else {
        setOk(true);
        setTexto("");
        setTimeout(() => {
          setOk(false);
          setAbierto(false);
        }, 1400);
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          setOk(false);
          setError(null);
        }}
        className="flex-shrink-0 rounded-full border border-azul px-3 py-1 text-[11.5px] font-bold text-azul hover:bg-[#EEF3FF]"
      >
        💬 Avisar
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-[12px] border border-borde bg-suave p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-bold text-tinta">Avisar a {nombre.split(/[\s,]+/)[0]}</span>
        <button type="button" onClick={() => setAbierto(false)} className="text-[11px] font-bold text-gris hover:underline">
          Cerrar
        </button>
      </div>
      {ok ? (
        <span className="py-1 text-[12px] font-bold text-verde">✓ Mensaje enviado a su chat.</span>
      ) : (
        <>
          <div className="flex items-end gap-1.5">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") enviar(texto);
              }}
              autoFocus
              placeholder="Escribí una indicación…"
              className="min-w-0 flex-1 rounded-[9px] border border-borde bg-tarjeta px-2.5 py-1.5 text-[12.5px] text-tinta outline-none focus:border-azul"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => enviar(texto)}
              className="rounded-[9px] bg-[#2453DC] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {pending ? "…" : "Enviar"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {SUGERENCIAS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending}
                onClick={() => enviar(s)}
                className="rounded-full border border-borde bg-tarjeta px-2 py-0.5 text-[10.5px] font-semibold text-gris hover:bg-suave disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
          {error && <span className="text-[10.5px] font-bold text-[#C0392B]">{error}</span>}
        </>
      )}
    </div>
  );
}

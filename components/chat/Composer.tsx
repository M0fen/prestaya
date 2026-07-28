"use client";
// Caja para escribir un mensaje del chat interno. Envía por Server Action y
// refresca la vista (RSC). Envío OPTIMISTA: limpia la caja al instante y, si
// falla, restaura el texto y muestra el error. Enter envía, Shift+Enter salta.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enviarMensaje } from "@/lib/acciones/chat";

// Acuse rápido: el cobrador responde a una orden en 1 toque, sin escribir. El
// supervisor ve en el hilo que la orden llegó y en qué va.
const ACUSES = ["✓ Recibido", "🏃 En camino", "✅ Hecho"];

export function Composer({ canal, acuse = false }: { canal: string; acuse?: boolean }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  // `preset` = acuse de 1 toque (no toca la caja de texto); sin preset envía lo escrito.
  const enviar = (preset?: string) => {
    const cuerpo = (preset ?? texto).trim();
    if (cuerpo.length === 0 || pendiente) return;
    setError(null);
    if (!preset) setTexto(""); // optimista: la caja se vacía ya (solo el texto escrito)
    startTransition(async () => {
      const res = await enviarMensaje({ canal, cuerpo });
      if (res.ok) {
        router.refresh();
      } else {
        if (!preset) setTexto(cuerpo); // falló: devolvemos el texto para reintentar
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {error && <span className="px-1 text-[11px] font-semibold text-[#C0392B]">{error}</span>}
      {pendiente && (
        <span className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-gris">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#DCE3F4] border-t-[#2453DC]" />
          Enviando…
        </span>
      )}
      {acuse && (
        <div className="flex flex-wrap gap-1.5">
          {ACUSES.map((a) => (
            <button
              key={a}
              type="button"
              disabled={pendiente}
              onClick={() => enviar(a)}
              className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[12px] font-bold text-[#2453DC] transition-transform active:scale-95 disabled:opacity-40"
            >
              {a}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          rows={1}
          placeholder="Escribí un mensaje…"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[14px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-azul"
        />
        <button
          type="button"
          onClick={() => enviar()}
          disabled={pendiente || texto.trim().length === 0}
          className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full bg-[#2453DC] text-[17px] text-white transition-transform active:scale-90 disabled:opacity-40"
          aria-label="Enviar"
        >
          {pendiente ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : "➤"}
        </button>
      </div>
    </div>
  );
}

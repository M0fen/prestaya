"use client";
// Caja para escribir un mensaje del chat interno. Envía por Server Action y
// refresca la vista (RSC). Envío OPTIMISTA: limpia la caja al instante y, si
// falla, restaura el texto y muestra el error. Enter envía, Shift+Enter salta.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enviarMensaje } from "@/lib/acciones/chat";

export function Composer({ canal }: { canal: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const enviar = () => {
    const cuerpo = texto.trim();
    if (cuerpo.length === 0 || pendiente) return;
    setError(null);
    setTexto(""); // optimista: la caja se vacía ya
    startTransition(async () => {
      const res = await enviarMensaje({ canal, cuerpo });
      if (res.ok) {
        router.refresh();
      } else {
        setTexto(cuerpo); // falló: devolvemos el texto para reintentar
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {error && <span className="px-1 text-[11px] font-semibold text-[#C0392B]">{error}</span>}
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
          onClick={enviar}
          disabled={pendiente || texto.trim().length === 0}
          className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full bg-[#2453DC] text-[17px] text-white transition-transform active:scale-90 disabled:opacity-40"
          aria-label="Enviar"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

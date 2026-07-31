"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Reportar "falta un pago". El cliente avisa si pagó y no figura.
//  Envía por Server Action (valida el token en el servidor). Tono amable,
//  sin acusar a nadie: es un canal para que la oficina revise.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { reportarFaltaPago } from "@/app/c/[token]/actions";

export function ReportarDiscrepancia({ token, prestamoId }: { token: string; prestamoId?: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dia, setDia] = useState("");
  const [comentario, setComentario] = useState("");
  const [pending, startTransition] = useTransition();

  function enviar() {
    setError(null);
    startTransition(async () => {
      const res = await reportarFaltaPago({
        token,
        prestamoId: prestamoId ?? null, // el crédito que el cliente está viendo (multi-crédito)
        diaCredito: dia ? Number(dia) : null,
        comentario: comentario || null,
      });
      if (res.ok) setEnviado(true);
      else setError(res.error);
    });
  }

  if (enviado) {
    return (
      <section className="flex items-center gap-3 rounded-[16px] border border-[#C7ECDA] bg-[#E7F6EF] px-4 py-3.5">
        <span className="text-[20px]" aria-hidden="true">
          ✓
        </span>
        <div className="flex flex-col">
          <span className="text-[13.5px] font-bold text-[#157A50]">
            ¡Gracias! Recibimos tu aviso.
          </span>
          <span className="text-[12px] font-medium text-[#3A7A5E]">
            La oficina lo revisará a la brevedad.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white px-4 py-3.5">
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="flex flex-col">
            <span className="text-[13.5px] font-bold text-tinta">
              ¿Falta un pago tuyo?
            </span>
            <span className="text-[12px] font-medium text-gris">
              Avisanos si pagaste y no aparece.
            </span>
          </span>
          <span className="rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12.5px] font-bold text-azul">
            Avisar
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="text-[13.5px] font-bold text-tinta">
            Contanos qué falta
          </span>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-gris">
              ¿Qué día pagaste? (opcional)
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              placeholder="Ej. 11"
              className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[16px] outline-none focus:border-azul"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-gris">
              Comentario (opcional)
            </span>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ej. Pagué $20.000 el lunes y no figura."
              className="resize-none rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[16px] outline-none focus:border-azul"
            />
          </label>

          {error && (
            <span className="text-[12.5px] font-semibold text-[#E06A6A]">
              {error}
            </span>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={enviar}
              className="flex-1 rounded-full bg-azul px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Enviar aviso"}
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-full px-3 py-2.5 text-[13px] font-semibold text-gris"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

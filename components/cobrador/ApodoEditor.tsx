"use client";
// Sobrenombre del trabajador (0132): lo elige él mismo y REEMPLAZA a su nombre
// real donde lo ven terceros (el comprobante que se comparte por WhatsApp).
// Vacío = volver al nombre real.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setApodo } from "@/lib/acciones/preferenciasCobrador";

export function ApodoEditor({ apodoActual }: { apodoActual: string | null }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(apodoActual ?? "");
  const [guardando, start] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const guardar = () =>
    start(async () => {
      setAviso(null);
      try {
        const r = await setApodo({ apodo: valor });
        if (r.ok) {
          setAviso({ ok: true, texto: valor.trim() ? "Listo: en el recibo vas a aparecer así." : "Listo: vuelve tu nombre real." });
          setAbierto(false);
          router.refresh();
        } else setAviso({ ok: false, texto: r.error });
      } catch {
        setAviso({ ok: false, texto: "Sin señal: probá de nuevo con conexión." });
      }
    });

  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-[#E6EAF4] bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[12.5px] font-bold text-tinta">🪪 Tu sobrenombre</span>
          <span className="text-[11px] font-medium text-gris">
            {apodoActual
              ? `Los clientes te ven como “${apodoActual}” en el recibo.`
              : "En el recibo que compartís aparece tu nombre real. Ponete un sobrenombre si preferís."}
          </span>
        </div>
        {!abierto && (
          <button
            type="button"
            onClick={() => {
              setAbierto(true);
              setAviso(null);
            }}
            className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-3.5 py-2 text-[12px] font-bold text-azul active:scale-95"
          >
            {apodoActual ? "Cambiar" : "Elegir"}
          </button>
        )}
      </div>
      {abierto && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            maxLength={24}
            placeholder="Ej. El Colo 😎"
            autoFocus
            className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[#DCE3F4] bg-white px-3 text-[16px] outline-none focus:border-azul"
          />
          <button
            type="button"
            disabled={guardando}
            onClick={guardar}
            className="min-h-11 rounded-full bg-[#1E47C8] px-4 text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {guardando ? "…" : "Guardar"}
          </button>
        </div>
      )}
      {aviso && (
        <p className={`text-[11.5px] font-semibold ${aviso.ok ? "text-[#157A50]" : "text-[#C0392B]"}`}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}

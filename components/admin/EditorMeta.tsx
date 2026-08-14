"use client";
// Editor de la META de recaudo mensual (gestores), inline en el Cierre del día.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarMetaMensual } from "@/lib/acciones/metaOperacion";

export function EditorMeta({ meta }: { meta: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(String(meta || ""));
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const guardar = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await guardarMetaMensual(Number(valor) || 0);
      if (res.ok) {
        setMsg({ ok: true, texto: "Guardado ✓" });
        setAbierto(false);
        router.refresh();
      } else {
        setMsg({ ok: false, texto: res.error });
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[12px] font-bold text-azul hover:underline"
      >
        {meta > 0 ? "Editar meta" : "Fijar meta"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-[12px] border border-borde px-2.5 py-1.5">
          <span className="text-[13px] font-bold text-gris">$</span>
          <input
            inputMode="numeric"
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className="w-28 text-[14px] tabular-nums outline-none"
            aria-label="Meta de recaudo mensual"
          />
        </div>
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="btn-primario px-3.5 py-1.5 text-[12px] font-extrabold text-white disabled:opacity-60"
        >
          {pendiente ? "…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded-full border border-borde px-3 py-1.5 text-[12px] font-bold text-gris"
        >
          Cancelar
        </button>
      </div>
      {msg && (
        <span className={`text-[11px] font-bold ${msg.ok ? "text-verde" : "text-[#C0392B]"}`}>
          {msg.texto}
        </span>
      )}
    </div>
  );
}

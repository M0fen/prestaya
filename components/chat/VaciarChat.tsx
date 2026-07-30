"use client";
// Botón (solo admin) para VACIAR el canal de chat activo. Acción destructiva:
// pide confirmación en dos pasos antes de borrar. Corre por Server Action que
// re-verifica que quien la ejecuta sea admin.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { vaciarCanal } from "@/lib/acciones/chat";

export function VaciarChat({ canal, titulo }: { canal: string; titulo: string }) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const ejecutar = () => {
    setError(null);
    startTransition(async () => {
      const res = await vaciarCanal(canal);
      if (res.ok) {
        setConfirmar(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  if (!confirmar) {
    return (
      <button
        type="button"
        onClick={() => setConfirmar(true)}
        title="Vaciar este canal (borra todos sus mensajes)"
        className="flex items-center gap-1 rounded-full border border-[#F0D2CE] bg-white px-2.5 py-2 text-[11.5px] font-bold text-[#C0392B] hover:bg-[#FDECEA]"
      >
        🗑 Vaciar
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold text-[#C0392B]">
        {error ?? `¿Borrar todo "${titulo}"?`}
      </span>
      <button
        type="button"
        onClick={ejecutar}
        disabled={pendiente}
        className="min-h-11 rounded-full bg-[#C0392B] px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-50"
      >
        {pendiente ? "Borrando…" : "Sí, borrar"}
      </button>
      <button
        type="button"
        onClick={() => { setConfirmar(false); setError(null); }}
        disabled={pendiente}
        className="min-h-11 rounded-full border border-[#DCE3F4] px-3 py-2 text-[11.5px] font-bold text-gris"
      >
        No
      </button>
    </div>
  );
}

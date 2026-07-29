"use client";
// A QUIÉNES les aparece la raspadita (0102). Reusa el SelectorSegmento (mismo de
// anuncios/quiniela/rifa/tienda). Por defecto "Todos"; el admin puede acotarla a un
// grupo. Es SOLO visibilidad promocional (no toca dinero).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SelectorSegmento } from "@/components/admin/SelectorSegmento";
import { setAudienciaRaspaditaAction } from "@/lib/acciones/juego";
import type { DefinicionSegmento } from "@/lib/segmentos";

export function AudienciaRaspadita({
  inicial,
  zonas,
}: {
  inicial: DefinicionSegmento | null;
  zonas: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [def, setDef] = useState<DefinicionSegmento | null>(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, start] = useTransition();

  const guardar = () =>
    start(async () => {
      setMsg(null);
      const r = await setAudienciaRaspaditaAction(def);
      setMsg(r.ok ? "Guardado ✓" : r.error);
      if (r.ok) router.refresh();
    });

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">¿A quiénes les aparece la raspadita?</span>
        <span className="text-[11.5px] font-medium text-tenue">
          Por defecto le aparece a todos. Podés acotarla a un grupo (por calificación, estado o zona).
        </span>
      </div>
      <SelectorSegmento value={def} onChange={setDef} zonas={zonas} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={pend}
          className="rounded-full bg-azul px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {pend ? "Guardando…" : "Guardar audiencia"}
        </button>
        {msg && <span className="text-[12px] font-semibold text-cuerpo">{msg}</span>}
      </div>
    </section>
  );
}

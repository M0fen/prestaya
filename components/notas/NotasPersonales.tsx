"use client";
// Bloc de notas PERSONAL (privado de cada usuario). Nadie más lo ve. Sirve como
// recordatorio propio. Alta y borrado simples con refresco de la vista.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { meses, horaDe } from "@/lib/format";
import { agregarNotaPersonal, borrarNotaPersonal } from "@/lib/acciones/notas";
import type { NotaPersonal } from "@/types/db";

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} · ${horaDe(iso)}`;
}

export function NotasPersonales({ notas }: { notas: NotaPersonal[] }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const agregar = () => {
    const cuerpo = texto.trim();
    if (!cuerpo || pendiente) return;
    setError(null);
    startTransition(async () => {
      const res = await agregarNotaPersonal({ cuerpo });
      if (res.ok) {
        setTexto("");
        router.refresh();
      } else setError(res.error);
    });
  };

  const borrar = (id: string) => {
    startTransition(async () => {
      const res = await borrarNotaPersonal({ id });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-[16px] bg-white p-3.5 shadow-sm">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escribí una nota para vos…"
          className="max-h-40 min-h-[56px] resize-none rounded-[12px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
        />
        {error && <span className="text-[11px] font-semibold text-[#C0392B]">{error}</span>}
        <button
          type="button"
          onClick={agregar}
          disabled={pendiente || texto.trim().length === 0}
          className="self-end rounded-full bg-[#2453DC] px-5 py-2 text-[13px] font-bold text-white disabled:opacity-40"
        >
          Guardar nota
        </button>
      </div>

      {notas.length === 0 ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Todavía no tenés notas. Son privadas, solo las ves vos.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notas.map((n) => (
            <li key={n.id} className="rounded-[14px] bg-white px-3.5 py-3 shadow-sm">
              <p className="text-[14px] leading-snug whitespace-pre-wrap text-tinta">{n.cuerpo}</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#AEB6CC]">{fechaCorta(n.creado_en)}</span>
                <button
                  type="button"
                  onClick={() => borrar(n.id)}
                  disabled={pendiente}
                  className="text-[11px] font-bold text-[#C0392B] disabled:opacity-40"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

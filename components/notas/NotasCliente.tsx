"use client";
// Notas por cliente (equipo). Las ve y agrega quien tiene acceso al cliente
// (cobrador asignado o gestor). Útiles en terreno: "pidió pasar mañana",
// "perro suelto", "cambió de casa". Borra el autor o un gestor.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { meses, horaDe } from "@/lib/format";
import { agregarNotaCliente, borrarNotaCliente } from "@/lib/acciones/notas";
import type { NotaClienteVista } from "@/lib/data/notas";

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} · ${horaDe(iso)}`;
}

export function NotasCliente({
  clienteId,
  notas,
  yoId,
  puedeGestionar,
}: {
  clienteId: string;
  notas: NotaClienteVista[];
  yoId: string;
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const agregar = () => {
    const cuerpo = texto.trim();
    if (!cuerpo || pendiente) return;
    setError(null);
    startTransition(async () => {
      const res = await agregarNotaCliente({ clienteId, cuerpo });
      if (res.ok) {
        setTexto("");
        router.refresh();
      } else setError(res.error);
    });
  };

  const borrar = (id: string) => {
    startTransition(async () => {
      const res = await borrarNotaCliente({ id, clienteId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] bg-tarjeta p-3.5 shadow-sm">
      <span className="text-[13px] font-bold text-tinta">Notas del cliente</span>

      <div className="flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={1}
          placeholder="Agregar una nota para el equipo…"
          className="max-h-28 min-h-[40px] flex-1 resize-none rounded-[12px] border border-campo px-3 py-2 text-[13.5px] outline-none focus:border-azul"
        />
        <button
          type="button"
          onClick={agregar}
          disabled={pendiente || texto.trim().length === 0}
          className="h-[40px] flex-shrink-0 btn-primario px-4 text-[13px] font-bold text-white disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      {error && <span className="text-[11px] font-semibold text-rojo-osc">{error}</span>}

      {notas.length === 0 ? (
        <p className="py-1 text-[12px] font-medium text-tenue">
          Sin notas todavía.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notas.map((n) => {
            const puedeBorrar = puedeGestionar || n.autor_id === yoId;
            return (
              <li key={n.id} className="rounded-[12px] bg-suave px-3 py-2">
                <p className="text-[13.5px] leading-snug whitespace-pre-wrap text-tinta">
                  {n.cuerpo}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-tenue">
                    {n.autorNombre} · {fechaCorta(n.creado_en)}
                  </span>
                  {puedeBorrar && (
                    <button
                      type="button"
                      onClick={() => borrar(n.id)}
                      disabled={pendiente}
                      className="text-[11px] font-bold text-rojo-osc disabled:opacity-40"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

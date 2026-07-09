"use client";
// Muestra el cobrador asignado del cliente y permite reasignarlo. Los candidatos
// ya vienen filtrados por lo que el rol puede hacer (admin: todos; supervisor:
// sus cobradores de la misma zona). El server re-valida con permisos.ts.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reasignarClienteAction } from "@/lib/acciones/asignaciones";

export interface CobradorOpcion {
  id: string;
  nombre: string;
}

export function ReasignarCliente({
  clienteId,
  actualId,
  actualNombre,
  candidatos,
  puedeReasignar,
}: {
  clienteId: string;
  actualId: string | null;
  actualNombre: string;
  candidatos: CobradorOpcion[];
  puedeReasignar: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-tinta">Cobrador asignado</span>
          <span className="text-[12.5px] font-medium text-gris">{actualNombre}</span>
        </div>
        {puedeReasignar && candidatos.length > 0 && (
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const nuevo = e.target.value;
              if (!nuevo || nuevo === actualId) return;
              setError(null);
              startTransition(async () => {
                const r = await reasignarClienteAction({ clienteId, nuevoCobradorId: nuevo });
                if (!r.ok) setError(r.error);
                else router.refresh();
              });
            }}
            className="rounded-[10px] border border-[#DCE3F1] bg-tarjeta px-2.5 py-1.5 text-[12.5px] font-semibold text-tinta outline-none focus:border-azul"
          >
            <option value="">Reasignar a…</option>
            {candidatos
              .filter((c) => c.id !== actualId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </select>
        )}
      </div>
      {error && <p className="mt-2 text-[11.5px] font-bold text-[#C0392B]">{error}</p>}
      {puedeReasignar && candidatos.length === 0 && (
        <p className="mt-2 text-[11px] font-medium text-tenue">
          No hay otros cobradores en esta zona para reasignar.
        </p>
      )}
    </section>
  );
}

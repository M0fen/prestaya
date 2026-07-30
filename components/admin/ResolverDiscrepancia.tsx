"use client";
// Control de TRIAGE por fila en /admin/empalme (0109): el admin marca una
// divergencia detectada como en progreso / resuelta / aceptada (baseline) con una
// nota. Deja de reclamar atención y queda la traza. Sin esto el panel solo mira.
import { useState, useTransition } from "react";
import { resolverDiscrepancia } from "@/lib/acciones/discrepancias";
import type { EstadoDiscrepancia } from "@/lib/data/discrepancias";

const ETIQUETA: Record<EstadoDiscrepancia, string> = {
  abierto: "Abierto",
  en_progreso: "En progreso",
  resuelto: "Resuelto",
  aceptado: "Aceptado (baseline)",
};
const OPCIONES: EstadoDiscrepancia[] = ["abierto", "en_progreso", "resuelto", "aceptado"];

function colorEstado(e: EstadoDiscrepancia): { bg: string; fg: string } {
  if (e === "resuelto" || e === "aceptado") return { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" };
  return { bg: "var(--color-ambar-suave, #FDF0D5)", fg: "var(--color-ambar-osc)" };
}

export function ResolverDiscrepancia({
  creditoId,
  tipo,
  montoDiferencia,
  triage,
}: {
  creditoId: string;
  tipo: string;
  montoDiferencia: number;
  triage: { estado: EstadoDiscrepancia; nota: string | null } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<EstadoDiscrepancia>(triage?.estado ?? "en_progreso");
  const [nota, setNota] = useState(triage?.nota ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const actual = triage?.estado ?? null;

  function guardar() {
    setErr(null);
    start(async () => {
      const r = await resolverDiscrepancia({ creditoId, estado, nota, tipo, montoDiferencia });
      if (!r.ok) setErr(r.error);
      else setAbierto(false);
    });
  }

  const c = actual ? colorEstado(actual) : { bg: "var(--color-suave)", fg: "var(--color-gris)" };

  return (
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="rounded-full px-2.5 py-1 text-[10.5px] font-bold hover:opacity-80"
        style={{ background: c.bg, color: c.fg }}
        title="Triage de esta discrepancia"
      >
        {actual ? ETIQUETA[actual] : "Revisar ▾"}
      </button>

      {abierto && (
        <div className="absolute top-full right-0 z-20 mt-1 flex w-[248px] flex-col gap-2 rounded-[12px] border border-borde bg-tarjeta p-3 shadow-lg">
          <label className="text-[10.5px] font-bold tracking-wide text-gris uppercase">Estado</label>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoDiscrepancia)}
            className="rounded-[8px] border border-borde bg-fondo px-2 py-1.5 text-[12.5px] font-medium text-tinta"
          >
            {OPCIONES.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA[o]}
              </option>
            ))}
          </select>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Nota: qué pasó / por qué se acepta como baseline…"
            className="resize-none rounded-[8px] border border-borde bg-fondo px-2 py-1.5 text-[12px] text-tinta"
          />
          {err && <span className="text-[11px] font-semibold text-rojo-osc">{err}</span>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-full px-3 py-1 text-[11.5px] font-bold text-gris hover:bg-suave"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={pending}
              className="rounded-full bg-azul px-3 py-1 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

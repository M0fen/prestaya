"use client";
// Bandeja de INCIDENCIAS (admin, 0107): triage de los reportes de bugs/problemas.
// Filtra por estado, muestra el contexto (usuario/rol/ruta) y mueve el estado
// abierto → en progreso → resuelto (con nota). Solo lectura + cambio de estado.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolverIncidencia } from "@/lib/acciones/incidencias";
import type { Incidencia, EstadoIncidencia } from "@/lib/data/incidencias";

const CAT_LABEL: Record<string, string> = {
  bug: "🐞 Error", confuso: "🤔 Confuso", lento: "🐌 Lento",
  dato_mal: "📊 Dato mal", sugerencia: "💡 Sugerencia", otro: "· Otro",
};
const EST_TONO: Record<EstadoIncidencia, { bg: string; fg: string; label: string }> = {
  abierto: { bg: "#FBE4E2", fg: "#C0392B", label: "Abierto" },
  en_progreso: { bg: "#FDF3E2", fg: "#B9770E", label: "En progreso" },
  resuelto: { bg: "#E4F5EC", fg: "#157A50", label: "Resuelto" },
};
const FILTROS: { v: "todas" | EstadoIncidencia; label: string }[] = [
  { v: "abierto", label: "Abiertas" },
  { v: "en_progreso", label: "En progreso" },
  { v: "resuelto", label: "Resueltas" },
  { v: "todas", label: "Todas" },
];

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function IncidenciasManager({ incidencias }: { incidencias: Incidencia[] }) {
  const [filtro, setFiltro] = useState<"todas" | EstadoIncidencia>("abierto");
  const lista = useMemo(
    () => incidencias.filter((i) => filtro === "todas" || i.estado === filtro),
    [incidencias, filtro],
  );
  const cont = (e: EstadoIncidencia) => incidencias.filter((i) => i.estado === e).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Mini k="Abiertas" v={cont("abierto")} tono="#C0392B" />
        <Mini k="En progreso" v={cont("en_progreso")} tono="#B9770E" />
        <Mini k="Resueltas" v={cont("resuelto")} tono="#157A50" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.v}
            type="button"
            onClick={() => setFiltro(f.v)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
              filtro === f.v ? "bg-azul text-white" : "border border-borde bg-tarjeta text-gris hover:bg-suave"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
          No hay incidencias con ese filtro. 🎉
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {lista.map((i) => <IncidenciaCard key={i.id} inc={i} />)}
        </div>
      )}
    </div>
  );
}

function Mini({ k, v, tono }: { k: string; v: number; tono: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-suave p-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</span>
      <span className="text-[17px] font-extrabold tabular-nums" style={{ color: v > 0 ? tono : "var(--color-tinta)" }}>{v}</span>
    </div>
  );
}

function IncidenciaCard({ inc }: { inc: Incidencia }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [nota, setNota] = useState("");
  const t = EST_TONO[inc.estado];
  const cambiar = (estado: EstadoIncidencia) =>
    start(async () => {
      await resolverIncidencia({ id: inc.id, estado, nota: estado === "resuelto" ? nota.trim() || null : null });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-cuerpo">{CAT_LABEL[inc.categoria] ?? inc.categoria}</span>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
      </div>
      <p className="whitespace-pre-line text-[13.5px] leading-[1.5] text-tinta">{inc.descripcion}</p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-medium text-tenue">
        <span className="font-bold text-gris">{inc.usuarioNombre ?? "—"}</span>
        {inc.rol && <span>· {inc.rol}</span>}
        {inc.ruta && <span>· <code className="rounded bg-suave px-1 font-mono text-[10.5px] text-cuerpo">{inc.ruta}</code></span>}
        <span>· {fechaHora(inc.creadoEn)}</span>
      </div>
      {inc.estado === "resuelto" ? (
        <span className="text-[11px] font-medium text-[#157A50]">
          ✓ Resuelto{inc.resueltoPorNombre ? ` por ${inc.resueltoPorNombre}` : ""}{inc.resueltoEn ? ` · ${fechaHora(inc.resueltoEn)}` : ""}
          {inc.notaResolucion ? ` — ${inc.notaResolucion}` : ""}
        </span>
      ) : (
        <div className="flex flex-col gap-1.5 border-t border-linea pt-2">
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            placeholder="Nota al resolver (opcional): qué se hizo…"
            className="rounded-[12px] border border-campo bg-tarjeta px-2.5 py-1.5 text-[12.5px] text-tinta outline-none focus:border-azul"
          />
          <div className="flex flex-wrap gap-1.5">
            {inc.estado === "abierto" && (
              <button type="button" onClick={() => cambiar("en_progreso")} disabled={pend}
                className="rounded-full border border-borde bg-tarjeta px-3 py-1 text-[12px] font-bold text-[#B9770E] disabled:opacity-50">
                Tomar (en progreso)
              </button>
            )}
            <button type="button" onClick={() => cambiar("resuelto")} disabled={pend}
              className="rounded-full bg-[#1FA971] px-3.5 py-1 text-[12px] font-extrabold text-white disabled:opacity-50">
              Marcar resuelto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

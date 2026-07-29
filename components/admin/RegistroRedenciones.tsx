"use client";
// Registro de REDENCIÓN de estrellas (admin): métricas + historial verificable con
// folio, premio y ENTREGA (separada de la aprobación). Filtros por estado/entrega.
// El admin marca "entregado" cuando el cliente recibe el premio. Solo lectura +
// la marca de entrega (no toca el conteo/cliente/folio: el registro es inmutable).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarEntregada } from "@/lib/acciones/estrellas";
import { meses } from "@/lib/format";
import type { RedencionHistorial, MetricasEstrellas } from "@/lib/data/estrellas";

function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const folioTxt = (f: number | null) => (f == null ? null : `N.º ${String(f).padStart(6, "0")}`);

export function RegistroRedenciones({
  historial,
  metricas,
}: {
  historial: RedencionHistorial[];
  metricas: MetricasEstrellas;
}) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [fEstado, setFEstado] = useState<"todas" | "aprobada" | "rechazada">("todas");
  const [fEntrega, setFEntrega] = useState<"todas" | "entregado" | "pendiente">("todas");

  const filtrados = useMemo(
    () =>
      historial.filter(
        (h) =>
          (fEstado === "todas" || h.estado === fEstado) &&
          (fEntrega === "todas" ||
            (h.estado === "aprobada" && (fEntrega === "entregado" ? h.entregado : !h.entregado))),
      ),
    [historial, fEstado, fEntrega],
  );

  const entregar = (id: string) =>
    start(async () => {
      await marcarEntregada(id);
      router.refresh();
    });

  const sel = "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[12.5px] outline-none focus:border-azul";

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">Registro de redención</span>
        <span className="text-[11px] font-medium text-tenue">
          Cada canje aprobado lleva un folio verificable. La entrega del premio se marca aparte.
        </span>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Mini k="Canjes" v={String(metricas.canjes)} sub={`${metricas.estrellasCanjeadas} ⭐`} />
        <Mini k="Pendientes" v={String(metricas.pendientes)} tono={metricas.pendientes > 0 ? "#B9770E" : undefined} />
        <Mini k="Por entregar" v={String(metricas.porEntregar)} tono={metricas.porEntregar > 0 ? "#C0392B" : undefined} />
        <Mini k="Entregados" v={String(metricas.entregadas)} tono="#157A50" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value as typeof fEstado)} className={sel}>
          <option value="todas">Todos los estados</option>
          <option value="aprobada">Aprobadas</option>
          <option value="rechazada">Rechazadas</option>
        </select>
        <select value={fEntrega} onChange={(e) => setFEntrega(e.target.value as typeof fEntrega)} className={sel}>
          <option value="todas">Entrega: todas</option>
          <option value="pendiente">Falta entregar</option>
          <option value="entregado">Ya entregadas</option>
        </select>
      </div>

      {filtrados.length === 0 ? (
        <p className="py-3 text-center text-[12.5px] font-medium text-gris">No hay canjes con ese filtro.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea">
          {filtrados.map((h) => {
            const aprob = h.estado === "aprobada";
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                <span
                  className="flex h-8 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[12px] font-black"
                  style={aprob ? { background: "#E4F5EC", color: "#157A50" } : { background: "#FBE4E2", color: "#C0392B" }}
                >
                  {h.estrellas}⭐
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-bold text-tinta">
                    {h.clienteNombre}
                    {folioTxt(h.folio) && (
                      <span className="ml-1.5 font-mono text-[10.5px] font-semibold text-azul">{folioTxt(h.folio)}</span>
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-tenue">
                    {aprob ? "Aprobado" : "Rechazado"}
                    {h.resueltoPorNombre ? ` por ${h.resueltoPorNombre}` : ""} · {fechaHora(h.resueltoEn)}
                    {h.premioTexto ? ` · 🎁 ${h.premioTexto}` : ""}
                  </span>
                  {aprob && h.entregado && (
                    <span className="text-[10.5px] font-semibold text-[#157A50]">
                      ✓ Entregado{h.entregadoPorNombre ? ` por ${h.entregadoPorNombre}` : ""} · {fechaHora(h.entregadoEn)}
                    </span>
                  )}
                </div>
                {aprob &&
                  (h.entregado ? (
                    <span className="flex-shrink-0 rounded-full bg-[#E7F6EF] px-2.5 py-1 text-[10.5px] font-bold text-[#157A50]">
                      Entregado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => entregar(h.id)}
                      disabled={pend}
                      className="flex-shrink-0 rounded-full bg-[#1FA971] px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50"
                    >
                      Marcar entregado
                    </button>
                  ))}
                {!aprob && (
                  <span className="flex-shrink-0 rounded-full bg-[#FCE8E8] px-2.5 py-1 text-[10.5px] font-bold text-[#C0392B]">
                    Rechazada
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Mini({ k, v, sub, tono }: { k: string; v: string; sub?: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-suave p-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</span>
      <span className="text-[16px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{v}</span>
      {sub && <span className="text-[10px] font-semibold text-tenue tabular-nums">{sub}</span>}
    </div>
  );
}

"use client";
// Gestión de zonas del admin: crear zona, asignar cobradores (una zona c/u) y
// marcar qué zonas cubre cada supervisor. Cada cambio llama a su Server Action
// (guardada por rol admin + auditada) y refresca los datos del servidor.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Zona } from "@/types/db";
import type { IntegranteZona } from "@/lib/data/zonas";
import {
  crearZonaAction,
  desactivarZonaAction,
  setZonaCobradorAction,
  setSupervisorZonaAction,
} from "@/lib/acciones/zonas";

const COLORES = ["#1E47C8", "#1FA971", "#E8A317", "#D64545", "#7A4DD6", "#158A8A", "#C0392B", "#2B6CB0"];

export function GestionZonas({
  zonas,
  equipo,
  supervisoresPorZona,
  conteo,
}: {
  zonas: Zona[];
  equipo: IntegranteZona[];
  supervisoresPorZona: Record<string, string[]>;
  conteo: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState(COLORES[0]);

  const cobradores = equipo.filter((u) => u.rol === "cobrador");
  const supervisores = equipo.filter((u) => u.rol === "supervisor");

  function ejecutar(p: Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await p;
      if (!r.ok) setError(r.error ?? "No se pudo guardar.");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-[12px] bg-[#FDECEA] px-4 py-2.5 text-[12.5px] font-bold text-[#C0392B]">
          {error}
        </div>
      )}

      {/* Crear zona */}
      <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-5">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Nueva zona</span>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 200 }}>
            <span className="text-[11.5px] font-bold text-gris">Nombre</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Centro, Cerro, Ruta 8…"
              className="rounded-[10px] border border-[#DCE3F1] px-3 py-2 text-[13.5px] font-medium text-tinta outline-none focus:border-azul"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold text-gris">Color</span>
            <div className="flex gap-1.5">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{ background: c, outline: color === c ? "2px solid #0F1B3D" : "none", outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={pending || nombre.trim().length < 2}
            onClick={() => {
              ejecutar(crearZonaAction({ nombre, color }));
              setNombre("");
            }}
            className="rounded-[10px] bg-azul px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Crear zona
          </button>
        </div>
      </section>

      {/* Zonas existentes */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Zonas ({zonas.length})
        </span>
        {zonas.length === 0 && (
          <p className="rounded-[14px] border border-dashed border-[#DCE3F1] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
            Todavía no hay zonas. Creá la primera arriba.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {zonas.map((z) => {
            const sups = supervisoresPorZona[z.id] ?? [];
            return (
              <div key={z.id} className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full" style={{ background: z.color ?? "#8A93AD" }} />
                  <span className="flex-1 truncate text-[15px] font-extrabold text-tinta">{z.nombre}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`¿Desactivar la zona "${z.nombre}"? Los cobradores quedan sin zona.`))
                        ejecutar(desactivarZonaAction(z.id));
                    }}
                    className="text-[11px] font-bold text-[#C0392B] hover:underline disabled:opacity-40"
                  >
                    Desactivar
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11.5px] font-medium">
                  <span className="rounded-full bg-linea px-2.5 py-0.5 text-[#5B6478]">
                    {conteo[z.id] ?? 0} cobrador{(conteo[z.id] ?? 0) === 1 ? "" : "es"}
                  </span>
                  <span className="rounded-full bg-[#EAF0FF] px-2.5 py-0.5 text-azul">
                    {sups.length} supervisor{sups.length === 1 ? "" : "es"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Cobradores → zona */}
      {cobradores.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Cobradores y su zona</span>
          <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {cobradores.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-tinta">{c.nombre}</span>
                <select
                  value={c.zona_id ?? ""}
                  disabled={pending}
                  onChange={(e) =>
                    ejecutar(setZonaCobradorAction({ cobradorId: c.id, zonaId: e.target.value || null }))
                  }
                  className="rounded-[10px] border border-[#DCE3F1] bg-tarjeta px-2.5 py-1.5 text-[12.5px] font-semibold text-tinta outline-none focus:border-azul"
                >
                  <option value="">Sin zona</option>
                  {zonas.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.nombre}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Supervisores → zonas (matriz de casillas) */}
      {supervisores.length > 0 && zonas.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Qué zonas cubre cada supervisor
          </span>
          <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                  <th className="px-4 py-2.5 text-left">Supervisor</th>
                  {zonas.map((z) => (
                    <th key={z.id} className="px-2 py-2.5 text-center">
                      {z.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supervisores.map((s) => {
                  const suyas = new Set(
                    Object.entries(supervisoresPorZona)
                      .filter(([, ids]) => ids.includes(s.id))
                      .map(([zid]) => zid),
                  );
                  const total = suyas.size;
                  return (
                    <tr key={s.id} className="border-b border-[#F4F6FB]">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-tinta">{s.nombre}</span>
                        {total === 0 && (
                          <span className="ml-2 rounded-full bg-[#FDF3E2] px-2 py-0.5 text-[10px] font-bold text-[#B9770E]">
                            ve todo
                          </span>
                        )}
                      </td>
                      {zonas.map((z) => {
                        const cubre = suyas.has(z.id);
                        return (
                          <td key={z.id} className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={cubre}
                              disabled={pending}
                              onChange={() =>
                                ejecutar(
                                  setSupervisorZonaAction({
                                    supervisorId: s.id,
                                    zonaId: z.id,
                                    cubre: !cubre,
                                  }),
                                )
                              }
                              className="h-4 w-4 cursor-pointer accent-[#1E47C8]"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-[1.6] font-medium text-tenue">
            Sin zonas marcadas, el supervisor ve toda la operación (compatibilidad). Al marcarle la
            primera zona, pasa a ver solo esa. La restricción es real: la aplica la base de datos, no solo la pantalla.
          </p>
        </section>
      )}
    </div>
  );
}

"use client";
// Tutorial in-app, ilustrado y por rol. Agrupa las guías por audiencia
// (cobrador / supervisor / admin) y las muestra como acordeón. El acceso ya
// viene resuelto: la página pasa solo las guías que este rol puede ver.
import { useState } from "react";
import type { Rol } from "@/types/db";
import {
  ROL_TUTORIAL,
  type GuiaTutorial,
} from "@/lib/tutorial/contenido";

const CARTON: { color: string; label: string; desc: string }[] = [
  { color: "#1FA971", label: "Pagado", desc: "el día tiene la cuota completa" },
  { color: "#E8A317", label: "Pendiente", desc: "abono parcial o el día de hoy sin completar" },
  { color: "#E06A6A", label: "Atrasado", desc: "día vencido sin pago" },
  { color: "#EEF1F8", label: "Futuro", desc: "todavía no vence" },
];

export function Tutorial({ guias, roles }: { guias: GuiaTutorial[]; roles: Rol[] }) {
  // Abre la primera guía por defecto para que se vea cómo funciona.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set(guias[0] ? [guias[0].id] : []));

  const toggle = (id: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <div className="flex flex-col gap-7">
      {roles.map((rol) => {
        const delRol = guias.filter((g) => g.rol === rol);
        if (delRol.length === 0) return null;
        const meta = ROL_TUTORIAL[rol];
        return (
          <section key={rol} className="flex flex-col gap-3">
            {/* Encabezado del grupo de rol */}
            <div
              className="flex items-center gap-3 rounded-[16px] px-4 py-3"
              style={{ background: meta.bg }}
            >
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] text-[18px] font-black text-white"
                style={{ background: meta.color }}
              >
                {rol === "cobrador" ? "🧑‍💼" : rol === "supervisor" ? "🎖️" : "👑"}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-[15px] font-extrabold" style={{ color: meta.color }}>
                  {meta.titulo}
                </span>
                <span className="text-[12px] font-medium text-[#5B6478]">{meta.quien}</span>
              </div>
              <span
                className="ml-auto rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold"
                style={{ color: meta.color }}
              >
                {delRol.length} guía{delRol.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Guías del rol (acordeón) */}
            <div className="flex flex-col gap-2.5">
              {delRol.map((g) => {
                const abierta = abiertas.has(g.id);
                return (
                  <div
                    key={g.id}
                    className="overflow-hidden rounded-[16px] border border-[#E6EAF4] bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(g.id)}
                      aria-expanded={abierta}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#F7F9FD]"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-[#EEF3FF] text-[17px]">
                        {g.icono}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[14px] font-extrabold text-tinta">{g.titulo}</span>
                        <span className="text-[12px] font-medium text-gris">{g.resumen}</span>
                      </span>
                      <span
                        className={`flex-shrink-0 text-[12px] font-black text-[#8A93AD] transition-transform ${
                          abierta ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </span>
                    </button>

                    {abierta && (
                      <div className="flex flex-col gap-3 border-t border-[#EEF1F8] px-4 py-4">
                        {g.leyendaCarton && (
                          <div className="rounded-[12px] bg-[#F1E8D2] p-3">
                            <span className="mb-2 block text-[11.5px] font-bold text-[#8A6D1E]">
                              Los colores del cartón
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              {CARTON.map((c) => (
                                <div key={c.label} className="flex items-center gap-2">
                                  <span
                                    className="h-4 w-4 flex-shrink-0 rounded-[5px]"
                                    style={{ background: c.color }}
                                  />
                                  <span className="text-[11.5px] leading-tight text-[#6B5A2E]">
                                    <b>{c.label}:</b> {c.desc}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <ol className="flex flex-col gap-3">
                          {g.pasos.map((p, i) => (
                            <li key={i} className="flex gap-3">
                              <span
                                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-black text-white"
                                style={{ background: ROL_TUTORIAL[rol].color }}
                              >
                                {i + 1}
                              </span>
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="text-[13.5px] font-bold text-tinta">{p.titulo}</span>
                                <span className="text-[13px] leading-[1.55] font-medium text-[#4E576F]">
                                  {p.cuerpo}
                                </span>
                                {p.tip && (
                                  <div className="mt-1 flex items-start gap-1.5 rounded-[10px] bg-[#FFF8E6] px-2.5 py-1.5">
                                    <span className="text-[12px]">💡</span>
                                    <span className="text-[11.5px] leading-[1.5] font-semibold text-[#8A6D1E]">
                                      {p.tip}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

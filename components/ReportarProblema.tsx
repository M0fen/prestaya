"use client";
// Botón flotante "Reportar un problema" (0107). Cualquier usuario interno reporta un
// inconveniente; auto-adjunta la ruta y el user-agent. Queda en la bandeja del admin
// (/admin/incidencias) para triage. No maneja dinero.
import { useState, useTransition } from "react";
import { reportarIncidencia } from "@/lib/acciones/incidencias";

const CATS: { v: string; label: string }[] = [
  { v: "bug", label: "Algo falló / dio error" },
  { v: "confuso", label: "Confuso / no entendí" },
  { v: "lento", label: "Lento / se colgó" },
  { v: "dato_mal", label: "Un dato está mal" },
  { v: "sugerencia", label: "Una sugerencia" },
  { v: "otro", label: "Otro" },
];

export function ReportarProblema() {
  const [abierto, setAbierto] = useState(false);
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("bug");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pend, start] = useTransition();

  const enviar = () =>
    start(async () => {
      setMsg(null);
      const r = await reportarIncidencia({
        descripcion: desc,
        categoria: cat,
        ruta: typeof window !== "undefined" ? window.location.pathname : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
      if (r.ok) {
        setOk(true);
        setDesc("");
        setTimeout(() => { setAbierto(false); setOk(false); }, 1600);
      } else setMsg(r.error);
    });

  const input = "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] text-tinta outline-none focus:border-azul";

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Reportar un problema"
        className="fixed bottom-20 right-3 z-[60] flex items-center gap-1.5 rounded-full bg-[#13308C]/90 px-3.5 py-2 text-[12.5px] font-bold text-white shadow-[0_6px_20px_rgba(19,48,140,0.35)] backdrop-blur active:scale-95 md:bottom-5"
      >
        <span aria-hidden>🐞</span>
        <span className="hidden sm:inline">Reportar</span>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setAbierto(false)}
        >
          <div
            className="flex w-full max-w-[420px] flex-col gap-3 rounded-t-[22px] bg-tarjeta p-4 sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-extrabold text-tinta">Reportar un problema</span>
              <button type="button" onClick={() => setAbierto(false)} className="text-[16px] font-bold text-gris" aria-label="Cerrar">✕</button>
            </div>

            {ok ? (
              <p className="py-5 text-center text-[13.5px] font-bold text-verde">¡Gracias! Lo registramos y lo vamos a revisar ✓</p>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-gris">¿Qué tipo de problema?</span>
                  <select value={cat} onChange={(e) => setCat(e.target.value)} className={input}>
                    {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </label>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Contanos qué pasó, en qué pantalla, y qué esperabas que pasara…"
                  className={`${input} resize-none`}
                />
                {msg && <span className="text-[12px] font-semibold text-[#C0392B]">{msg}</span>}
                <span className="text-[10.5px] font-medium text-tenue">
                  Se envía con la pantalla donde estás y tu usuario, para poder resolverlo más rápido.
                </span>
                <button
                  type="button"
                  onClick={enviar}
                  disabled={pend || desc.trim().length < 3}
                  className="rounded-full bg-azul px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50"
                >
                  {pend ? "Enviando…" : "Enviar reporte"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

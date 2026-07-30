"use client";
// Panel FLOTANTE del ADMIN para aprobar los gastos de ruta de los cobradores sin
// salir de donde está (pedido: gestionarlos cómodo, muy a la vista). Aparece solo
// cuando hay pendientes; carga la lista al abrir (no en cada navegación) y aprueba/
// rechaza inline reusando las acciones money-safe (admin-only + kill-switch).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listarGastosPendientes, aprobarGastoRuta, rechazarGastoRuta } from "@/lib/acciones/gastos";
import type { SolicitudGasto } from "@/lib/data/solicitudesGasto";
import { UYU } from "@/lib/format";

function horaUY(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function PanelGastosFlotante({ pendientes }: { pendientes: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<SolicitudGasto[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pend, start] = useTransition();

  const abrir = async () => {
    setAbierto(true);
    if (items === null && !cargando) {
      setCargando(true);
      setError(null);
      const r = await listarGastosPendientes();
      if (r.ok) setItems(r.items);
      else setError(r.error);
      setCargando(false);
    }
  };

  // Saca la solicitud de la lista local y refresca el badge/servidor.
  const quitar = (id: string) => {
    setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    router.refresh();
  };

  const aprobar = (id: string) =>
    start(async () => {
      setError(null);
      const r = await aprobarGastoRuta({ solicitudId: id });
      if (r.ok) quitar(id);
      else setError(r.error);
    });

  const confirmarRechazo = (id: string) =>
    start(async () => {
      setError(null);
      const r = await rechazarGastoRuta({ solicitudId: id, motivo: motivo.trim() || undefined });
      if (r.ok) {
        setRechazando(null);
        setMotivo("");
        quitar(id);
      } else setError(r.error);
    });

  // La lista viva: mientras no cargó, el conteo del server; luego, lo local.
  const n = items ? items.length : pendientes;
  if (n === 0 && !abierto) return null; // sin pendientes → sin FAB (no clutter)

  return (
    <>
      {/* FAB: encima del 🐞 (que está encima del asesor), abajo-derecha. */}
      <button
        type="button"
        onClick={abrir}
        aria-label="Aprobar gastos de ruta"
        className="fixed right-4 bottom-[13rem] z-[60] flex items-center gap-1.5 rounded-full bg-[#E8A317] px-3.5 py-2 text-[12.5px] font-black text-[#0F1B3D] shadow-[0_6px_20px_rgba(232,163,23,0.4)] active:scale-95 md:bottom-[8.5rem]"
      >
        <span aria-hidden>💸</span>
        <span>{n > 9 ? "9+" : n} por aprobar</span>
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setAbierto(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-[440px] flex-col rounded-t-[22px] bg-tarjeta sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-linea px-4 py-3">
              <span className="text-[15px] font-extrabold text-tinta">Gastos por aprobar</span>
              <button type="button" onClick={() => setAbierto(false)} className="text-[16px] font-bold text-gris" aria-label="Cerrar">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {error && <p className="mb-2 rounded-[10px] bg-rojo-suave px-3 py-2 text-[12px] font-semibold text-rojo-osc">{error}</p>}
              {cargando ? (
                <p className="py-8 text-center text-[13px] font-medium text-gris">Cargando…</p>
              ) : !items || items.length === 0 ? (
                <p className="py-8 text-center text-[13px] font-bold text-verde-osc">✓ No hay gastos pendientes.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {items.map((s) => (
                    <li key={s.id} className="flex flex-col gap-2 rounded-[14px] border border-borde bg-suave p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[13.5px] font-bold text-tinta">{s.cobradorNombre ?? "Cobrador"}</span>
                          <span className="text-[11.5px] font-medium text-gris">
                            {s.categoria ?? "Gasto"} · {horaUY(s.solicitadoEn)}
                          </span>
                        </div>
                        <span className="flex-shrink-0 text-[16px] font-black tabular-nums text-tinta">{UYU(s.monto)}</span>
                      </div>
                      {s.descripcion && <p className="text-[12.5px] leading-[1.4] text-cuerpo">{s.descripcion}</p>}
                      {s.comprobanteUrl && (
                        <a href={s.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-azul underline">
                          📎 Ver comprobante
                        </a>
                      )}

                      {rechazando === s.id ? (
                        <div className="flex flex-col gap-1.5">
                          <input
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            maxLength={200}
                            placeholder="Motivo del rechazo (opcional)"
                            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul"
                          />
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => { setRechazando(null); setMotivo(""); }} className="rounded-full px-3 py-1.5 text-[12px] font-bold text-gris">Cancelar</button>
                            <button type="button" disabled={pend} onClick={() => confirmarRechazo(s.id)} className="rounded-full bg-rojo-osc px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">
                              {pend ? "…" : "Confirmar rechazo"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled={pend} onClick={() => setRechazando(s.id)} className="rounded-full border border-borde px-3.5 py-1.5 text-[12px] font-bold text-gris hover:bg-tarjeta disabled:opacity-60">
                            Rechazar
                          </button>
                          <button type="button" disabled={pend} onClick={() => aprobar(s.id)} className="rounded-full bg-[#1FA971] px-4 py-1.5 text-[12px] font-extrabold text-white active:scale-95 disabled:opacity-60">
                            {pend ? "…" : "Aprobar"}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";
// Historial de pagos del crédito en la ficha del COBRADOR (decisión 08-05).
// Plegado por defecto (la ficha sigue liviana para cobrar); al abrirlo muestra
// los pagos del libro, más reciente primero. Para un cobro PROPIO de un día
// anterior (ventana de "deshacer" ya vencida) ofrece PEDIR CORRECCIÓN: crea una
// solicitud de anulación que el supervisor/admin debe avalar (doble registro) —
// el cobrador nunca toca el libro solo.
import { useState, useTransition } from "react";
import { solicitarAnulacionAction } from "@/lib/acciones/anulaciones";
import { UYU } from "@/lib/format";

const VENTANA_DESHACER_MS = 60 * 60 * 1000; // igual que deshacerPagoAction

export type PagoHistorial = {
  id: string;
  monto: number;
  registradoEn: string;
  diaCredito: number | null;
  esMio: boolean;
  /** null = trabajo en la app; otro valor = importado/ajuste (no se corrige acá). */
  origen: string | null;
};

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const TANDA = 15;

export function HistorialPagos({ pagos }: { pagos: PagoHistorial[] }) {
  const [abierto, setAbierto] = useState(false);
  const [verMas, setVerMas] = useState(TANDA);
  // Pedido de corrección en curso: id del pago + motivo tipeado.
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, startEnviar] = useTransition();
  const [aviso, setAviso] = useState<{ pagoId: string; ok: boolean; texto: string } | null>(null);

  if (pagos.length === 0) return null;
  const orden = [...pagos].sort(
    (a, b) => new Date(b.registradoEn).getTime() - new Date(a.registradoEn).getTime(),
  );
  const visibles = orden.slice(0, verMas);
  const ahora = Date.now();

  const pedir = (pagoId: string) => {
    const m = motivo.trim();
    if (m.length < 3) {
      setAviso({ pagoId, ok: false, texto: "Contá qué está mal (monto correcto, qué pasó)." });
      return;
    }
    setAviso(null);
    startEnviar(async () => {
      try {
        const r = await solicitarAnulacionAction({ pagoId, motivo: m });
        if (r.ok) {
          setPidiendo(null);
          setMotivo("");
          setAviso({
            pagoId,
            ok: true,
            texto: "Listo: la oficina lo va a revisar y te corrigen el cobro. Quedó constancia de que lo reportaste vos.",
          });
        } else {
          setAviso({ pagoId, ok: false, texto: r.error });
        }
      } catch {
        setAviso({ pagoId, ok: false, texto: "Sin señal: probá de nuevo con conexión." });
      }
    });
  };

  return (
    <div className="flex flex-col rounded-[14px] bg-white p-3.5 shadow-sm">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex min-h-11 items-center justify-between text-left"
      >
        <span className="text-[12.5px] font-bold text-tinta">
          📜 Historial de pagos <span className="font-medium text-gris">· {pagos.length}</span>
        </span>
        <span className="text-[13px] font-bold text-gris">{abierto ? "▴" : "▾"}</span>
      </button>

      {abierto && (
        <ul className="mt-1.5 flex flex-col divide-y divide-[#F0F2F9]">
          {visibles.map((p) => {
            const vencida = ahora - new Date(p.registradoEn).getTime() > VENTANA_DESHACER_MS;
            // Corregible: cobro PROPIO, hecho EN LA APP, pasada la ventana de
            // deshacer (dentro de la ventana ya existe "Deshacer" arriba).
            const corregible = p.esMio && p.origen === null && vencida;
            const abiertoEste = pidiendo === p.id;
            return (
              <li key={p.id} className="flex flex-col gap-1.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col leading-tight">
                    <span className="text-[13px] font-bold text-tinta tabular-nums">{UYU(p.monto)}</span>
                    <span className="text-[10.5px] font-medium text-[#8A93AD]">
                      {fechaCorta(p.registradoEn)}
                      {p.diaCredito != null ? ` · cuota ${p.diaCredito}` : ""}
                      {p.origen !== null ? " · registro de oficina" : ""}
                    </span>
                  </div>
                  {corregible && !abiertoEste && (
                    <button
                      type="button"
                      onClick={() => {
                        setPidiendo(p.id);
                        setMotivo("");
                        setAviso(null);
                      }}
                      className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[11.5px] font-bold text-[#6B7494] active:scale-95"
                    >
                      Pedir corrección
                    </button>
                  )}
                </div>
                {abiertoEste && (
                  <div className="flex flex-col gap-1.5 rounded-[11px] bg-[#F6F8FD] p-2.5">
                    <span className="text-[11px] leading-[1.45] font-medium text-gris">
                      La corrección la aprueba tu supervisor o la oficina. El pago no se borra:
                      queda anulado con tu reporte como constancia.
                    </span>
                    <textarea
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      rows={2}
                      maxLength={300}
                      placeholder="Ej.: el monto correcto es $500, tipeé de más."
                      className="rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[16px] outline-none focus:border-azul"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPidiendo(null)}
                        className="min-h-10 rounded-full border border-[#DCE3F4] bg-white px-3.5 text-[12px] font-bold text-gris"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={enviando}
                        onClick={() => pedir(p.id)}
                        className="min-h-10 flex-1 rounded-full bg-[#1E47C8] px-3.5 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                      >
                        {enviando ? "Enviando…" : "Enviar pedido"}
                      </button>
                    </div>
                  </div>
                )}
                {aviso && aviso.pagoId === p.id && (
                  <p
                    className={`rounded-[10px] px-3 py-2 text-[11.5px] leading-[1.45] font-semibold ${
                      aviso.ok ? "bg-[#E4F5EC] text-[#157A50]" : "bg-[#FBE4E2] text-[#C0392B]"
                    }`}
                  >
                    {aviso.texto}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {abierto && orden.length > verMas && (
        <button
          type="button"
          onClick={() => setVerMas((v) => v + TANDA)}
          className="mt-1 min-h-10 rounded-[10px] border border-[#DCE3F4] bg-white text-[12px] font-bold text-azul"
        >
          Ver más ▾
        </button>
      )}
    </div>
  );
}

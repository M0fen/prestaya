"use client";
// Gastos de ruta del cobrador — AHORA con aprobación del admin (0057). El cobrador
// SOLICITA el gasto ("necesito sacar para X"); queda pendiente hasta que el admin
// lo apruebe. Recién aprobado sale de la caja y baja el efectivo a entregar.
import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { UYU, horaDe } from "@/lib/format";
import { solicitarGastoRuta, subirComprobanteGasto } from "@/lib/acciones/gastos";
import { CATEGORIAS_GASTO, pideComprobante, hintComprobante } from "@/lib/gastosRuta";
import type { SolicitudGasto } from "@/lib/data/solicitudesGasto";

const CATEGORIAS = CATEGORIAS_GASTO;

const ESTADO: Record<SolicitudGasto["estado"], { label: string; bg: string; fg: string }> = {
  pendiente: { label: "Pendiente", bg: "#FDF3E2", fg: "#B9770E" },
  aprobada: { label: "Aprobado", bg: "#E4F5EC", fg: "#157A50" },
  rechazada: { label: "Rechazado", bg: "#FBE4E2", fg: "#C0392B" },
};

export function GastosRuta({
  solicitudes,
}: {
  solicitudes: { pendientes: number; aprobadoTotal: number; items: SolicitudGasto[] };
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("Combustible");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const montoN = Math.round(Number(monto) || 0);
  const requiere = pideComprobante(categoria);
  const puedeSolicitar = montoN > 0 && !subiendo && (!requiere || !!comprobante);

  // Foto del comprobante: se sube apenas se elige (cámara en el celu) y se guarda
  // la URL; sin foto válida no se puede solicitar cuando la actividad la exige.
  const subirFoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir la misma foto
    if (!f) return;
    setError(null);
    setSubiendo(true);
    const fd = new FormData();
    fd.append("file", f);
    const res = await subirComprobanteGasto(fd);
    setSubiendo(false);
    if (res.ok) setComprobante(res.url);
    else setError(res.error);
  };

  const solicitar = () => {
    if (!puedeSolicitar) return;
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await solicitarGastoRuta({ monto: montoN, categoria, descripcion: nota, comprobanteUrl: comprobante });
      if (res.ok) {
        setMonto("");
        setNota("");
        setComprobante(null);
        setOk(true);
        router.refresh();
      } else setError(res.error);
    });
  };

  const resumen =
    solicitudes.pendientes > 0
      ? `${solicitudes.pendientes} pendiente${solicitudes.pendientes === 1 ? "" : "s"} de aprobación`
      : solicitudes.aprobadoTotal > 0
        ? `${UYU(solicitudes.aprobadoTotal)} aprobado hoy`
        : "Sin gastos hoy";

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex flex-col">
          <span className="text-[14px] font-extrabold text-tinta">Gastos de ruta</span>
          <span className="text-[12px] font-medium text-gris">{resumen}</span>
        </div>
        <span className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul">
          {abierto ? "Cerrar" : "+ Solicitar"}
        </span>
      </button>

      {abierto && (
        <div className="mt-3.5 flex flex-col gap-3 border-t border-[#EEF1F8] pt-3.5">
          <p className="rounded-[10px] bg-[#FDF9EF] px-3 py-2 text-[11.5px] font-medium text-[#8A6D1E]">
            Pedís sacar plata para un gasto; el admin lo aprueba. Recién aprobado se descuenta de tu caja.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIAS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c)}
                className={`rounded-full px-3 py-2 text-[12.5px] font-bold transition active:scale-95 ${
                  categoria === c ? "bg-[#2453DC] text-white" : "bg-[#EEF1F8] text-gris"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {/* Montos rápidos: pedir en un toque (los más comunes de ruta). */}
          <div className="flex flex-wrap gap-1.5">
            {[500, 1000, 2000, 3000].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonto(String(m))}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition active:scale-95 ${
                  montoN === m ? "bg-[#2453DC] text-white" : "bg-[#EEF1F8] text-gris"
                }`}
              >
                ${m.toLocaleString("es-UY")}
              </button>
            ))}
          </div>

          {/* Comprobante (foto/factura), según la actividad. Obligatorio en
              combustible/peaje/otro; en comida es opcional. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-bold text-gris">
              {hintComprobante(categoria)}
              {requiere && <span className="text-[#C0392B]"> *</span>}
            </span>
            {comprobante ? (
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={comprobante}
                  alt="Comprobante"
                  className="h-14 w-14 flex-shrink-0 rounded-[10px] border border-[#DCE3F4] object-cover"
                />
                <span className="flex-1 text-[12.5px] font-bold text-[#157A50]">✓ Foto adjunta</span>
                <button
                  type="button"
                  onClick={() => setComprobante(null)}
                  className="text-[12px] font-bold text-gris underline"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <label
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-3 text-[13px] font-bold transition active:scale-[0.99] ${
                  subiendo ? "border-[#DCE3F4] text-gris" : "border-[#B9C6E8] text-azul"
                }`}
              >
                {subiendo ? "Subiendo…" : "📷 Sacar / adjuntar foto"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={subirFoto}
                  disabled={subiendo}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 rounded-[12px] border border-[#DCE3F4] px-3 py-2.5">
              <span className="text-[15px] font-bold text-gris">$</span>
              <input
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="w-full text-[16px] tabular-nums outline-none"
                aria-label="Monto del gasto"
              />
            </div>
            <button
              type="button"
              onClick={solicitar}
              disabled={pendiente || !puedeSolicitar}
              className="min-h-11 rounded-[12px] bg-[#1FA971] px-4 py-3 text-[14px] font-extrabold text-white transition-transform active:scale-95 disabled:opacity-40"
            >
              {pendiente ? "…" : "Solicitar"}
            </button>
          </div>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={160}
            placeholder="Para qué es (opcional)"
            className="w-full rounded-[12px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          />
          {error && <p className="text-[12px] font-semibold text-[#C0392B]">{error}</p>}
          {ok && <p className="text-[12px] font-semibold text-[#157A50]">✓ Solicitud enviada. Esperá la aprobación del admin.</p>}

          {solicitudes.items.length > 0 && (
            <ul className="flex flex-col divide-y divide-[#EEF1F8]">
              {solicitudes.items.map((g) => {
                const e = ESTADO[g.estado];
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold text-tinta">
                        {g.categoria ?? "Gasto"}
                        {g.descripcion ? <span className="font-normal text-gris"> · {g.descripcion}</span> : ""}
                      </span>
                      <span className="text-[11px] font-medium text-[#8A93AD]">
                        {horaDe(g.solicitadoEn)}
                        {g.estado === "rechazada" && g.motivoRechazo ? ` · ${g.motivoRechazo}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: e.bg, color: e.fg }}
                      >
                        {e.label}
                      </span>
                      <span className="text-[13.5px] font-extrabold tabular-nums text-[#C0392B]">−{UYU(g.monto)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

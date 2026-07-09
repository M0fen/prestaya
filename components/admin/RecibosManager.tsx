"use client";
// Emisión de RECIBOS a trabajadores (admin). Form → emite → muestra el recibo
// imprimible. Abajo, el historial (cada uno se puede volver a ver/imprimir).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { emitirRecibo } from "@/lib/acciones/recibos";
import type { Recibo } from "@/lib/data/recibos";

const input =
  "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[14px] text-tinta outline-none focus:border-azul";
const CONCEPTOS = ["Comisión", "Sueldo", "Adelanto", "Viáticos", "Otro"];

function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function RecibosManager({
  trabajadores,
  recibos,
  negocio,
}: {
  trabajadores: { id: string; nombre: string }[];
  recibos: Recibo[];
  negocio: string;
}) {
  const router = useRouter();
  const [trabajadorId, setTrabajadorId] = useState(trabajadores[0]?.id ?? "");
  const [concepto, setConcepto] = useState(CONCEPTOS[0]);
  const [monto, setMonto] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [nota, setNota] = useState("");
  const [pendiente, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emitido, setEmitido] = useState<Recibo | null>(null);

  const emitir = () => {
    setError(null);
    const t = trabajadores.find((x) => x.id === trabajadorId);
    start(async () => {
      const res = await emitirRecibo({
        trabajadorId: trabajadorId || null,
        trabajadorNombre: t?.nombre ?? "",
        concepto,
        monto: Number(monto),
        periodo,
        nota,
      });
      if (res.ok) {
        setEmitido(res.recibo);
        setMonto("");
        setNota("");
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Recibo recién emitido (imprimible) */}
      {emitido && (
        <div className="flex flex-col gap-2">
          <ReciboImprimible recibo={emitido} negocio={negocio} />
          <div className="flex gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full bg-[#2453DC] px-4 py-2 text-[13px] font-bold text-white"
            >
              🖨 Imprimir
            </button>
            <button
              type="button"
              onClick={() => setEmitido(null)}
              className="rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-gris"
            >
              Emitir otro
            </button>
          </div>
        </div>
      )}

      {/* Formulario de emisión */}
      {!emitido && (
        <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4 print:hidden">
          <span className="text-[14px] font-extrabold text-tinta">Emitir recibo</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-gris">Trabajador</span>
              <select className={input} value={trabajadorId} onChange={(e) => setTrabajadorId(e.target.value)}>
                {trabajadores.length === 0 && <option value="">(sin trabajadores)</option>}
                {trabajadores.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-gris">Concepto</span>
              <select className={input} value={concepto} onChange={(e) => setConcepto(e.target.value)}>
                {CONCEPTOS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-gris">Monto (UYU)</span>
              <input className={input} type="number" inputMode="decimal" min={1} value={monto}
                onChange={(e) => setMonto(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-gris">Período (opcional)</span>
              <input className={input} placeholder="Ej: Julio 2026" value={periodo}
                onChange={(e) => setPeriodo(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gris">Nota (opcional)</span>
            <input className={input} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />
          </label>
          {error && <span className="text-[12px] font-semibold text-[#C0392B]">{error}</span>}
          <button
            type="button"
            onClick={emitir}
            disabled={pendiente || !monto || trabajadores.length === 0}
            className="rounded-full bg-[#1FA971] px-5 py-2.5 text-[14px] font-extrabold text-white disabled:opacity-50"
          >
            {pendiente ? "Emitiendo…" : "Emitir recibo"}
          </button>
        </div>
      )}

      {/* Historial */}
      <div className="flex flex-col gap-2 print:hidden">
        <span className="text-[13px] font-bold text-tinta">Recibos emitidos</span>
        {recibos.length === 0 ? (
          <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-5 text-center text-[12.5px] font-medium text-gris">
            Todavía no emitiste recibos.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {recibos.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEmitido(r)}
                className="flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-suave"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-bold text-tinta">
                    #{r.numero} · {r.trabajadorNombre}
                  </span>
                  <span className="text-[11.5px] font-medium text-tenue">
                    {r.concepto}{r.periodo ? ` · ${r.periodo}` : ""} · {fechaLarga(r.emitidoEn)}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-tinta">{UYU(r.monto)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Recibo imprimible (comprobante interno de pago). */
function ReciboImprimible({ recibo, negocio }: { recibo: Recibo; negocio: string }) {
  return (
    <div className="mx-auto w-full max-w-[520px] rounded-[16px] border border-borde bg-white p-6 text-[#0F1B3D]">
      <div className="flex items-start justify-between border-b border-[#E6EAF4] pb-3">
        <div className="flex flex-col">
          <span className="text-[17px] font-extrabold">{negocio}</span>
          <span className="text-[12px] font-medium text-[#6B7494]">Recibo de pago</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[12px] font-bold text-[#6B7494]">N.º</span>
          <span className="text-[20px] font-extrabold tabular-nums">{recibo.numero}</span>
        </div>
      </div>

      <dl className="flex flex-col gap-2 py-4 text-[13.5px]">
        <Fila k="Recibí de" v={negocio} />
        <Fila k="Pagado a" v={recibo.trabajadorNombre} negrita />
        <Fila k="Concepto" v={recibo.concepto} />
        {recibo.periodo && <Fila k="Período" v={recibo.periodo} />}
        {recibo.nota && <Fila k="Nota" v={recibo.nota} />}
        <Fila k="Fecha" v={fechaLarga(recibo.emitidoEn)} />
      </dl>

      <div className="flex items-center justify-between rounded-[12px] bg-[#F1FBF6] px-4 py-3">
        <span className="text-[13px] font-bold text-[#157A50]">Total</span>
        <span className="text-[22px] font-extrabold tabular-nums text-[#157A50]">{UYU(recibo.monto)}</span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 text-center text-[11.5px] text-[#6B7494]">
        <div className="border-t border-[#0F1B3D] pt-1">Firma de quien recibe</div>
        <div className="border-t border-[#0F1B3D] pt-1">
          {recibo.emitidoPorNombre ? `Por ${recibo.emitidoPorNombre}` : "Firma de quien paga"}
        </div>
      </div>
    </div>
  );
}

function Fila({ k, v, negrita = false }: { k: string; v: string; negrita?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex-shrink-0 text-[#6B7494]">{k}</dt>
      <dd className={`text-right ${negrita ? "font-extrabold" : "font-semibold"}`}>{v}</dd>
    </div>
  );
}

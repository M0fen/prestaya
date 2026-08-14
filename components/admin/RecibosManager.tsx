"use client";
// Emisión de RECIBOS a trabajadores (admin). Form → emite → muestra el recibo
// imprimible. Abajo, el historial (cada uno se puede volver a ver/imprimir).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { emitirRecibo } from "@/lib/acciones/recibos";
import { montoALetras } from "@/lib/numeroALetras";
import type { Recibo } from "@/lib/data/recibos";
import type { Negocio } from "@/types/cartones";

const input =
  "rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[14px] text-tinta outline-none focus:border-azul";
const CONCEPTOS = ["Comisión", "Sueldo", "Adelanto", "Viáticos", "Otro"];

function fechaLarga(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha ilegible → "—" (evita "Invalid Date")
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function RecibosManager({
  trabajadores,
  recibos,
  negocio,
}: {
  trabajadores: { id: string; nombre: string; documento?: string | null }[];
  recibos: Recibo[];
  negocio: Negocio;
}) {
  const router = useRouter();
  // Documento por trabajador (para mostrarlo en el comprobante sin guardarlo en la fila).
  const docPorTrabajador = new Map(trabajadores.map((t) => [t.id, t.documento ?? null]));
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
          <ReciboImprimible
            recibo={emitido}
            negocio={negocio}
            documento={docPorTrabajador.get(emitido.trabajadorId ?? "") ?? null}
          />
          <div className="flex gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-primario px-4 py-2 text-[13px] font-bold text-white"
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

/** Recibo imprimible (comprobante interno de pago) con datos fiscales, documento
 *  del que recibe y el monto EN LETRAS (lo que hace serio a un recibo). */
function ReciboImprimible({
  recibo,
  negocio,
  documento,
}: {
  recibo: Recibo;
  negocio: Negocio;
  documento: string | null;
}) {
  const fiscal = [
    negocio.rut ? `RUT ${negocio.rut}` : null,
    negocio.direccion || null,
    negocio.telefono ? `Tel. ${negocio.telefono}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const numero = String(recibo.numero).padStart(6, "0");

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[16px] border border-borde bg-white p-6 text-[#0F1B3D]">
      {/* Encabezado: negocio + datos fiscales | comprobante numerado */}
      <div className="flex items-start justify-between gap-3 border-b border-[#E6EAF4] pb-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[18px] font-extrabold tracking-[-0.01em]">{negocio.nombre}</span>
          {fiscal && <span className="mt-0.5 text-[10.5px] font-medium leading-snug text-[#6B7494]">{fiscal}</span>}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end">
          <span className="rounded-[7px] bg-[#EEF3FF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1E47C8]">
            Recibo de pago
          </span>
          <span className="mt-1 text-[11px] font-bold text-[#6B7494]">N.º</span>
          <span className="text-[18px] font-extrabold tabular-nums leading-none">{numero}</span>
        </div>
      </div>

      <dl className="flex flex-col gap-2 py-4 text-[13.5px]">
        <Fila k="Recibí de" v={negocio.nombre} />
        <Fila k="Pagado a" v={recibo.trabajadorNombre + (documento ? `  (Doc. ${documento})` : "")} negrita />
        <Fila k="Concepto" v={recibo.concepto} />
        {recibo.periodo && <Fila k="Período" v={recibo.periodo} />}
        {recibo.nota && <Fila k="Nota" v={recibo.nota} />}
        <Fila k="Fecha" v={fechaLarga(recibo.emitidoEn)} />
      </dl>

      {/* Total en cifras + EN LETRAS (anti-adulteración, estándar del comprobante) */}
      <div className="flex flex-col gap-1 rounded-[12px] bg-[#F1FBF6] px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#157A50]">Total</span>
          <span className="text-[22px] font-extrabold tabular-nums text-[#157A50]">{UYU(recibo.monto)}</span>
        </div>
        <span className="text-[12px] font-semibold text-[#157A50]">
          Son: {montoALetras(recibo.monto)}.
        </span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 text-center text-[11.5px] text-[#6B7494]">
        <div className="border-t border-[#0F1B3D] pt-1">
          Firma de quien recibe
          {documento && <div className="text-[10px] text-[#8A93AC]">Doc. {documento}</div>}
        </div>
        <div className="border-t border-[#0F1B3D] pt-1">
          {recibo.emitidoPorNombre ? `Por ${recibo.emitidoPorNombre}` : "Firma de quien paga"}
        </div>
      </div>

      <p className="mt-4 text-center text-[9.5px] leading-snug text-tenue-2">
        Comprobante interno de pago. No es una factura fiscal (DGI).
      </p>
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

"use client";
// Cartón digital MEJORADO: grilla de los N días con estados claros, sello ✓ que
// aparece con un "pop" (escalonado), día de HOY con anillo que late, hitos cada
// 5 días y bandera de meta, y DETALLE al tocar una casilla (fecha, monto,
// recibos). Todo con CSS liviano; las animaciones se anulan con reduce-motion.
import { useState } from "react";
import type { DiaCarton, EstadoDia, UnidadFrecuencia } from "@/types/cartones";

const UNIDAD_DEFECTO: UnidadFrecuencia = {
  singular: "día", plural: "días", cada: "día por día", ord: "Día",
};

type Props = {
  dias: DiaCarton[];
  diaActual: number;
  totalDias: number;
  /** Unidad según la frecuencia del crédito (día/semana/quincena/mes). */
  unidad?: UnidadFrecuencia;
};

const V: Record<EstadoDia, { bg: string; fg: string; label: string }> = {
  pagado: { bg: "#1FA971", fg: "#FFFFFF", label: "Pagado" },
  pendiente: { bg: "#E8A317", fg: "#FFFFFF", label: "Abono parcial" },
  atrasado: { bg: "#E06A6A", fg: "#FFFFFF", label: "Pendiente" },
  futuro: { bg: "#EEF1F8", fg: "#9AA3BC", label: "Próximo" },
};

export function CartonDigital({ dias, diaActual, totalDias, unidad = UNIDAD_DEFECTO }: Props) {
  const [sel, setSel] = useState<number | null>(null);
  const [verFechas, setVerFechas] = useState(false);
  const diaSel = sel != null ? dias.find((d) => d.dia === sel) ?? null : null;

  // Delay escalonado del sello ✓ solo para los días pagados (efecto de entrada).
  let indicePagado = 0;

  // En crédito DIARIO el cobro es Lun–Sáb (no domingo). El cartón es un bloque
  // LIMPIO de 6 casillas por fila (una "semana" de cobro), con el día 1
  // arriba-izquierda. NO es un calendario alineado al día de semana real, así que
  // NO se rotula L–M–M–J–V–S: engañaría si el crédito no arranca un lunes (el día 1
  // caería bajo "L" igual). La cadencia se dice en texto y las FECHAS exactas están
  // en "Ver todas las fechas".
  const porSemana = unidad.ord === "Día";

  return (
    <section className="rounded-[22px] border border-[#ECEFF8] bg-white px-[18px] py-5 shadow-[0_1px_3px_rgba(15,27,61,0.05),0_10px_26px_rgba(15,27,61,0.04)]">
      <div className="mb-1 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] font-bold tracking-[0.04em] text-gris uppercase">
            Tu cartón
          </span>
          <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.02em] text-tinta">
            Pago {unidad.cada}
          </h2>
        </div>
        <span className="rounded-full bg-[#EEF3FF] px-2.5 py-[5px] text-[12.5px] font-bold text-azul">
          {unidad.ord} {diaActual}/{totalDias}
        </span>
      </div>

      <p className="mt-1 text-[11.5px] font-medium text-gris">
        {porSemana ? "Cobro de lunes a sábado (el domingo no se cobra). " : ""}
        Tocá una casilla para ver el detalle.
      </p>

      {/* Ventana aparte con la FECHA de cada cuota (calendario del crédito). */}
      <button
        type="button"
        onClick={() => setVerFechas(true)}
        className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-borde bg-suave px-3 py-1.5 text-[12px] font-bold text-azul active:scale-95"
      >
        📅 Ver todas las fechas
      </button>

      <div className="mt-3 grid grid-cols-6 gap-2">
        {dias.map((box) => {
          const c = V[box.estado];
          const pagado = box.estado === "pagado";
          const delay = pagado ? `${Math.min(indicePagado++ * 45, 900)}ms` : "0ms";
          const activo = box.dia === sel;
          return (
            <button
              key={box.dia}
              type="button"
              onClick={() => setSel(activo ? null : box.dia)}
              aria-pressed={activo}
              aria-label={`${unidad.ord} ${box.dia}: ${c.label}${box.montoPagado ? `, ${box.montoPagado}` : ""}`}
              className="relative flex aspect-square flex-col items-center justify-center rounded-[14px] outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-azul"
              style={{
                background: c.bg,
                color: c.fg,
                border: box.estado === "futuro" ? "1px solid #E4E8F4" : "none",
                fontVariantNumeric: "tabular-nums",
                boxShadow: box.esHoy
                  ? undefined
                  : box.estado === "futuro"
                    ? "none"
                    : "0 1px 2px rgba(15,27,61,0.10)",
                transform: activo ? "translateY(-2px)" : undefined,
              }}
            >
              {/* Anillo que late en el día de HOY */}
              {box.esHoy && (
                <span
                  aria-hidden="true"
                  className="py-hoy-ring pointer-events-none absolute inset-0 rounded-[14px]"
                  style={{ boxShadow: `0 0 0 3px #FFFFFF, 0 0 0 6px ${c.bg}` }}
                />
              )}

              {pagado ? (
                <span
                  className="py-sello text-[19px] leading-none font-black"
                  style={{ animationDelay: delay }}
                >
                  ✓
                </span>
              ) : (
                <span className="text-[17px] leading-none font-bold">{box.dia}</span>
              )}

              {box.esHoy && (
                <span className="mt-0.5 text-[7.5px] leading-none font-black tracking-[0.08em] text-white/[0.92]">
                  HOY
                </span>
              )}

              {/* Hito cada 5 días (punto dorado). Meta = bandera. */}
              {box.esMeta ? (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1 text-[12px]">
                  🏁
                </span>
              ) : (
                box.esHito && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1 h-[6px] w-[6px] rounded-full bg-[#F5C24B] ring-1 ring-white/70"
                  />
                )
              )}
            </button>
          );
        })}
      </div>

      {/* Detalle del día seleccionado, o leyenda si no hay selección */}
      <div className="mt-4 border-t border-[#EEF1F8] pt-4">
        {diaSel ? (
          <div className="flex flex-col gap-2 rounded-[14px] bg-[#F7F9FD] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-extrabold text-tinta">
                {unidad.ord} {diaSel.dia} · <span className="font-semibold text-gris">{diaSel.fechaLarga}</span>
              </span>
              <button
                type="button"
                onClick={() => setSel(null)}
                aria-label="Cerrar detalle"
                className="flex h-11 w-11 items-center justify-center -my-2.5 -mr-2.5 text-[16px] leading-none text-gris active:scale-90"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                style={{ background: V[diaSel.estado].bg, color: V[diaSel.estado].fg }}
              >
                {V[diaSel.estado].label}
              </span>
              {diaSel.montoPagado && (
                <span className="text-[13px] font-extrabold text-tinta">{diaSel.montoPagado}</span>
              )}
            </div>
            {diaSel.pagos.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {diaSel.pagos.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-[#3A445F]"
                  >
                    <span className="truncate">
                      🕒 {p.hora}
                      {p.quien ? ` · cobró ${p.quien}` : ""}
                    </span>
                    <span className="flex-shrink-0 font-bold">{p.monto}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[12px] font-medium text-gris">
                {diaSel.estado === "futuro"
                  ? "Todavía no vence. ¡Vas bien!"
                  : "Sin pago registrado este día."}
              </span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-[9px]">
            {(
              [
                { color: "#1FA971", label: "Pagado", border: false },
                { color: "#E8A317", label: "Abono parcial", border: false },
                { color: "#E06A6A", label: "Pendiente", border: false },
                { color: "#EEF1F8", label: "Próximo", border: true },
              ] as const
            ).map((it) => (
              <div key={it.label} className="flex items-center gap-2">
                <span
                  className="block h-3.5 w-3.5 flex-shrink-0 rounded-[5px]"
                  style={{ background: it.color, border: it.border ? "1px solid #E4E8F4" : undefined }}
                />
                <span className="text-[12.5px] font-semibold text-[#3A445F]">{it.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="block h-[7px] w-[7px] flex-shrink-0 rounded-full bg-[#F5C24B] ring-1 ring-white" />
              <span className="text-[12.5px] font-semibold text-[#3A445F]">Hito (cada 5)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] leading-none">🏁</span>
              <span className="text-[12.5px] font-semibold text-[#3A445F]">Meta final</span>
            </div>
          </div>
        )}
      </div>

      {/* Ventana aparte: la fecha de CADA cuota del cartón, de un vistazo. */}
      {verFechas && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0F1B3D]/45 sm:items-center sm:p-4"
          onClick={() => setVerFechas(false)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[22px] bg-white sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-linea px-4 py-3">
              <span className="text-[14px] font-extrabold text-tinta">Fechas de cada {unidad.singular}</span>
              <button
                type="button"
                onClick={() => setVerFechas(false)}
                aria-label="Cerrar"
                className="flex h-11 w-11 items-center justify-center text-[18px] leading-none text-gris active:scale-90"
              >
                ✕
              </button>
            </div>
            <ul className="flex-1 divide-y divide-[#F2F5FB] overflow-y-auto">
              {dias.map((d) => (
                <li key={d.dia} className={`flex items-center gap-3 px-4 py-2.5 ${d.esHoy ? "bg-[#EEF3FF]" : ""}`}>
                  <span className="w-7 flex-shrink-0 text-right text-[12px] font-bold text-gris tabular-nums">{d.dia}</span>
                  <span className="min-w-0 flex-1 text-[13px] font-semibold text-tinta">
                    {d.fechaLarga}
                    {d.esHoy && <span className="ml-1.5 rounded-full bg-azul px-1.5 py-0.5 text-[10px] font-black text-white">HOY</span>}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    <span
                      className="block h-2.5 w-2.5 rounded-full"
                      style={{ background: V[d.estado].bg, border: d.estado === "futuro" ? "1px solid #E4E8F4" : undefined }}
                    />
                    <span className="text-[11.5px] font-semibold text-gris">{V[d.estado].label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

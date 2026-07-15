"use client";
// Historial de pagos. Cada fila se expande en un COMPROBANTE con la hora de
// cada pago y un sello de "Registrado ✓" (sirve como prueba ante dudas).
import { useState } from "react";
import type { HistorialItem } from "@/types/cartones";

// Colapsado se ven 2 pagos completos + un pedazo del 3ero (recorte + degradado),
// para ahorrar espacio; "Ver más" despliega el resto.
export function Historial({ historial }: { historial: HistorialItem[] }) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const hayMas = historial.length > 2;
  // Colapsado: renderizamos 3 filas pero recortamos la altura para dejar el 3ero
  // asomando. Expandido: todas.
  const visibles = verTodos ? historial : historial.slice(0, 3);
  const ocultos = historial.length - 2;
  // No recortar mientras haya un comprobante ABIERTO: si no, al tocar uno de los
  // primeros pagos su detalle (hora, monto) quedaba cortado por el degradado.
  const recortar = !verTodos && hayMas && abierto == null;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between px-0.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] font-bold tracking-[0.04em] text-gris uppercase">
            Historial
          </span>
          <h2 className="m-0 text-[16px] font-extrabold tracking-[-0.02em] text-tinta">
            Pagos realizados
          </h2>
        </div>
        <span className="rounded-full bg-[#F2F5FC] px-2.5 py-1 text-[12px] font-extrabold text-tinta tabular-nums">
          {historial.length}
        </span>
      </div>

      {historial.length === 0 && (
        <p className="rounded-[15px] border border-dashed border-[#ECEFF8] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Todavía no hay pagos registrados.
        </p>
      )}

      <div className="relative">
      <div
        className="flex flex-col gap-2"
        style={recortar ? { maxHeight: 168, overflow: "hidden" } : undefined}
      >
        {visibles.map((pago) => {
          const expandido = abierto === pago.dia;
          return (
            <div
              key={pago.dia}
              className="overflow-hidden rounded-[15px] border border-[#ECEFF8] bg-white shadow-[0_1px_2px_rgba(15,27,61,0.04)]"
            >
              <button
                type="button"
                onClick={() => setAbierto(expandido ? null : pago.dia)}
                aria-expanded={expandido}
                className="flex w-full items-center justify-between px-[15px] py-[13px] text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-[38px] w-[38px] flex-shrink-0 flex-col items-center justify-center rounded-[11px] border border-[#EAEEF8] bg-[#F2F5FC] leading-none">
                    <span className="text-[9px] font-bold tracking-[0.02em] text-[#8A93AD] uppercase">
                      Día
                    </span>
                    <span className="text-[15px] font-extrabold text-tinta tabular-nums">
                      {pago.dia}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[15px] font-bold text-tinta tabular-nums">
                      {pago.monto}
                    </span>
                    <span className="text-[12px] font-medium text-gris capitalize">
                      {pago.fecha}
                    </span>
                    {/* % de la cuota que cubrió ese pago */}
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: pago.completa ? "#157A50" : "#9A6A0E" }}
                    >
                      {pago.completa
                        ? "Cuota completa (100%)"
                        : `Abono parcial · ${pago.pctCuota}% de la cuota`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span style={pago.chipStyle}>{pago.estadoLabel}</span>
                  <span
                    className="text-[11px] text-[#9AA3BC] transition-transform"
                    style={{ transform: expandido ? "rotate(180deg)" : "none" }}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </div>
              </button>

              {expandido && (
                <div className="border-t border-[#EEF1F8] bg-[#FAFBFE] px-[15px] py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[#157A50]">
                    <span aria-hidden="true">✓</span>
                    <span>Comprobante · {pago.fechaLarga}</span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {pago.pagos.map((r, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between text-[13px]"
                      >
                        <span className="font-medium text-gris">
                          Pago a las {r.hora} h
                          {r.quien ? ` · ${r.quien}` : ""}
                        </span>
                        <span className="font-bold text-tinta tabular-nums">
                          {r.monto}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Resumen del día: cuánto de la cuota cubrió + descuento */}
                  <div className="mt-2.5 flex flex-col gap-1 border-t border-[#EEF1F8] pt-2.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-gris">Cubrió de la cuota</span>
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: pago.completa ? "#157A50" : "#9A6A0E" }}
                      >
                        {pago.pctCuota}%{pago.completa ? " · completa" : " · parcial"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-gris">Descuento aplicado</span>
                      <span className="font-bold text-tinta">{pago.descuento ?? "No"}</span>
                    </div>
                  </div>

                  <p className="mt-2.5 text-[11px] leading-[1.4] font-medium text-[#9AA3BC]">
                    Registrado por la oficina. Si algún pago tuyo no figura,
                    usá el botón de abajo para avisarnos.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
        {/* Degradado que "corta" el 3er pago asomando (efecto de que hay más). */}
        {recortar && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            style={{ background: "linear-gradient(to top, var(--color-app, #F6F8FD), transparent)" }}
          />
        )}
      </div>

      {hayMas && (
        <button
          type="button"
          onClick={() => setVerTodos((v) => !v)}
          className="mt-1 self-center rounded-full border border-[#DCE3F4] bg-white px-4 py-2 text-[13px] font-bold text-azul"
        >
          {verTodos ? "Ver menos" : `Ver más (${ocultos})`}
        </button>
      )}
    </section>
  );
}

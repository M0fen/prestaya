"use client";
// ─────────────────────────────────────────────────────────────────────────
//  "JORNADA ABIERTA" — la barra que trae el cierre al pulgar.
//
//  EL PROBLEMA, medido (03-09): en todo el piloto se cerraron 4 jornadas. En 30
//  días pasaron $9.250.920 por la calle en 145 días-cobrador sin una sola caja
//  cerrada. No es un bug del cálculo: el arrastre de caja está escrito y probado
//  —lo que le quedó ayer amanece hoy como base— pero se alimenta del ACTA de
//  cierre, y si nadie cierra, la app no tiene de dónde sacar el número y todos
//  amanecen en $0. La queja "la caja no queda de un día para otro" es esto.
//
//  Y cerrar estaba al FINAL de la home: después de la bienvenida, el resumen,
//  los pedidos, la ruta entera y los gastos. Cuatro a seis pantallas de scroll,
//  todos los días, en un teléfono, parado en la calle.
//
//  Esta barra vive fija arriba de la nav, aparece SOLO cuando hay algo que
//  cerrar, y se aparta sola cuando el bloque de cierre ya está en pantalla (no
//  tapa lo que el cobrador está por completar).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { UYU } from "@/lib/format";

export function BarraCierreJornada({
  recaudado,
  cobros,
  /** Jornadas de días ANTERIORES que quedaron sin rendir (plata sin sello). */
  atrasadas = 0,
}: {
  recaudado: number;
  cobros: number;
  atrasadas?: number;
}) {
  /** Se esconde cuando el bloque de cierre entra en pantalla: ahí ya llegó. */
  const [tapando, setTapando] = useState(false);

  useEffect(() => {
    const destino = document.getElementById("cierre");
    if (!destino || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entradas) => setTapando(entradas.some((e) => e.isIntersecting)),
      { rootMargin: "0px 0px -120px 0px" },
    );
    obs.observe(destino);
    return () => obs.disconnect();
  }, []);

  if (tapando) return null;

  return (
    // `bottom` = alto de la nav inferior + el inset del home indicator.
    <div
      className="print:hidden fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[480px] items-center gap-3 px-3"
      role="status"
    >
      <a
        href="#cierre"
        className="flex flex-1 items-center gap-3 rounded-[14px] border-2 border-[#E8A317] bg-[#FFF8E8] px-3.5 py-2.5 shadow-[0_8px_20px_rgba(15,27,61,0.18)] active:scale-[0.99]"
      >
        <span aria-hidden="true" className="text-[20px] leading-none">
          🌙
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[12.5px] font-extrabold text-[#8A6D1E]">
            {atrasadas > 0
              ? `Jornada abierta · y ${atrasadas} día${atrasadas === 1 ? "" : "s"} sin rendir`
              : "Jornada abierta — cerrá para cuadrar tu caja"}
          </span>
          <span className="truncate text-[11.5px] font-semibold text-[#8A6D1E]/80 tabular-nums">
            Llevás {UYU(recaudado)} en {cobros} cobro{cobros === 1 ? "" : "s"}
          </span>
        </span>
        <span className="flex-shrink-0 rounded-full bg-[#1FA971] px-3.5 py-2 text-[12.5px] font-extrabold text-white">
          Cerrar caja
        </span>
      </a>
    </div>
  );
}

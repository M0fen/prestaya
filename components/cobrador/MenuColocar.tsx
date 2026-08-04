"use client";
// ─────────────────────────────────────────────────────────────────────────
//  El botón "+" de la ruta. Antes iba directo a Censar; ahora abre las tres
//  cosas que el cobrador puede hacer para sumar plata a su ruta:
//    · Renovar — el cliente terminó de pagar y arranca de nuevo (1 toque).
//    · Nueva venta — otro crédito para un cliente que ya no tiene ninguno.
//    · Censar — la persona todavía no existe en el sistema.
//  Orden a propósito: lo más frecuente arriba. Censar es lo más raro de los
//  tres (un cliente nuevo de verdad) pero sigue estando: sin él no se puede
//  sumar a nadie desde la calle.
// ─────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";

const OPCIONES = [
  {
    href: "/cobrador/colocar?modo=renovar",
    emoji: "🔁",
    titulo: "Renovar",
    detalle: "Terminó de pagar y arranca de nuevo, igual que antes",
  },
  {
    href: "/cobrador/colocar?modo=venta",
    emoji: "💵",
    titulo: "Nueva venta",
    detalle: "Otro crédito para un cliente tuyo, con el monto que elijas",
  },
  {
    href: "/cobrador/censar",
    emoji: "🧍",
    titulo: "Censar cliente nuevo",
    detalle: "La persona todavía no está en el sistema",
  },
];

export function MenuColocar() {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="min-h-11 rounded-full bg-[#EEF3FF] px-3.5 text-[12.5px] font-bold text-azul active:scale-95"
      >
        + Agregar
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setAbierto(false)}
          role="presentation"
        >
          <div
            className="flex w-full flex-col gap-2 rounded-t-[22px] bg-white p-4 pb-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-[#DCE3F4]" aria-hidden="true" />
            <span className="mb-1 text-[15px] font-extrabold text-tinta">¿Qué querés hacer?</span>

            {OPCIONES.map((o) => (
              <Link
                key={o.href}
                href={o.href}
                onClick={() => setAbierto(false)}
                className="flex items-center gap-3 rounded-[14px] bg-[#F7F9FD] px-3.5 py-3.5 active:scale-[0.99]"
              >
                <span aria-hidden="true" className="text-[20px]">
                  {o.emoji}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-extrabold text-tinta">{o.titulo}</span>
                  <span className="text-[11.5px] leading-[1.4] font-medium text-gris">
                    {o.detalle}
                  </span>
                </span>
              </Link>
            ))}

            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="mt-1 min-h-11 rounded-full text-[13px] font-bold text-gris"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

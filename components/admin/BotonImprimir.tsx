"use client";
// Botón que dispara la impresión del navegador (→ "Guardar como PDF").
// Se oculta al imprimir (print:hidden) para que no salga en el documento.
export function BotonImprimir({ label = "Imprimir / Guardar PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-1.5 rounded-full bg-[#2453DC] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1E47C8]"
    >
      <span aria-hidden>🖨️</span>
      {label}
    </button>
  );
}

// Cartón digital: grid de los N días del crédito + leyenda de colores.
// Cada celda usa el estilo pre-calculado en loanView (color según estado).
import type { DiaCarton } from "@/types/cartones";

type Props = {
  dias: DiaCarton[];
  diaActual: number;
  totalDias: number;
};

const LEYENDA = [
  { color: "#1FA971", label: "Pagado", border: false },
  { color: "#E8A317", label: "Abono parcial", border: false },
  { color: "#E06A6A", label: "Pendiente", border: false },
  { color: "#EEF1F8", label: "Próximo", border: true },
] as const;

export function CartonDigital({ dias, diaActual, totalDias }: Props) {
  return (
    <section className="rounded-[22px] border border-[#ECEFF8] bg-white px-[18px] py-5 shadow-[0_1px_3px_rgba(15,27,61,0.05),0_10px_26px_rgba(15,27,61,0.04)]">
      <div className="mb-1 flex items-end justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] font-bold tracking-[0.04em] text-gris uppercase">
            Tu cartón
          </span>
          <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.02em] text-tinta">
            Pago día por día
          </h2>
        </div>
        <span className="rounded-full bg-[#EEF3FF] px-2.5 py-[5px] text-[12.5px] font-bold text-azul">
          Día {diaActual}/{totalDias}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-6 gap-2">
        {dias.map((box) => (
          <div key={box.dia} style={box.style}>
            <span className="text-[17px] leading-none font-bold tabular-nums">
              {box.dia}
            </span>
            {box.esHoy && (
              <span className="mt-0.5 text-[7.5px] leading-none font-black tracking-[0.08em] text-white/[0.92]">
                HOY
              </span>
            )}
          </div>
        ))}
      </div>

      {/* leyenda */}
      <div className="mt-[18px] grid grid-cols-2 gap-x-3.5 gap-y-[9px] border-t border-[#EEF1F8] pt-4">
        {LEYENDA.map((it) => (
          <div key={it.label} className="flex items-center gap-2">
            <span
              className="block h-3.5 w-3.5 flex-shrink-0 rounded-[5px]"
              style={{
                background: it.color,
                border: it.border ? "1px solid #E4E8F4" : undefined,
              }}
            />
            <span className="text-[12.5px] font-semibold text-[#3A445F]">
              {it.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Próxima cuota: valor de la cuota, fecha larga y texto relativo (Hoy/Mañana/…).
import type { VistaCredito } from "@/types/cartones";

type Props = Pick<
  VistaCredito,
  "cuotaDiaria" | "proxFechaLarga" | "proxRelativo"
>;

export function ProximaCuota({
  cuotaDiaria,
  proxFechaLarga,
  proxRelativo,
}: Props) {
  return (
    <section className="flex items-center justify-between gap-3.5 rounded-[20px] border border-[#D9E2FB] bg-[linear-gradient(135deg,#EEF3FF,#E6EDFF)] px-5 py-[18px]">
      <div className="flex flex-col gap-[5px]">
        <span className="text-[11.5px] font-bold tracking-[0.04em] text-azul uppercase">
          Próxima cuota
        </span>
        <span className="text-[32px] leading-none font-extrabold tracking-[-0.03em] text-tinta tabular-nums">
          {cuotaDiaria}
        </span>
        <span className="text-[13px] font-medium text-gris capitalize">
          {proxFechaLarga}
        </span>
      </div>
      <div className="flex min-w-[84px] flex-shrink-0 flex-col items-center gap-1.5 rounded-[16px] border border-[#DCE3F4] bg-white px-4 py-3 shadow-[0_4px_12px_rgba(30,71,200,0.10)]">
        <span className="text-[11px] font-semibold tracking-[0.03em] text-gris uppercase">
          A pagar
        </span>
        <span className="text-[15px] font-extrabold text-azul">
          {proxRelativo}
        </span>
      </div>
    </section>
  );
}

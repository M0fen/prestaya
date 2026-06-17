// Tarjeta resumen principal (azul): saldo pendiente, estado general,
// barra de progreso y datos del préstamo.
import type { VistaCredito } from "@/types/cartones";

type Props = Pick<
  VistaCredito,
  | "estadoGeneral"
  | "estadoDotStyle"
  | "falta"
  | "totalAPagar"
  | "barFillStyle"
  | "totalPagado"
  | "progresoTexto"
  | "montoPrestado"
  | "diaActual"
  | "totalDias"
  | "fechaFinLarga"
>;

export function ResumenCard({
  estadoGeneral,
  estadoDotStyle,
  falta,
  totalAPagar,
  barFillStyle,
  totalPagado,
  progresoTexto,
  montoPrestado,
  diaActual,
  totalDias,
  fechaFinLarga,
}: Props) {
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(150deg,#2453DC_0%,#1E47C8_45%,#13308C_100%)] px-[22px] pt-6 pb-[22px] text-white shadow-[0_16px_34px_rgba(19,48,140,0.34)]">
      {/* círculos decorativos */}
      <div className="absolute -top-[60px] -right-[50px] h-[200px] w-[200px] rounded-full bg-white/[0.07]" />
      <div className="absolute -bottom-[90px] -left-[40px] h-[200px] w-[200px] rounded-full bg-white/[0.05]" />

      <div className="relative flex items-center justify-between">
        <span className="text-[12.5px] font-semibold tracking-[0.04em] text-white/[0.78] uppercase">
          Saldo pendiente
        </span>
        <div className="flex items-center gap-[7px] rounded-full bg-white/[0.16] py-1.5 pr-[11px] pl-[9px] backdrop-blur-[4px]">
          <span style={estadoDotStyle} />
          <span className="text-[12px] font-bold text-white">
            {estadoGeneral}
          </span>
        </div>
      </div>

      <div className="relative mt-2 flex items-end gap-[9px]">
        <span className="text-[42px] leading-none font-extrabold tracking-[-0.035em] tabular-nums">
          {falta}
        </span>
        <span className="mb-[5px] text-[14px] font-medium text-white/[0.72]">
          de {totalAPagar}
        </span>
      </div>

      <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-white/[0.20]">
        <div style={barFillStyle} />
      </div>

      <div className="relative mt-[11px] flex items-center justify-between">
        <div className="flex flex-col leading-[1.25]">
          <span className="text-[11px] font-semibold tracking-[0.03em] text-white/[0.66] uppercase">
            Pagado
          </span>
          <span className="text-[15.5px] font-bold tabular-nums">
            {totalPagado}
          </span>
        </div>
        <div className="text-center">
          <span className="text-[23px] font-extrabold text-white tabular-nums">
            {progresoTexto}
          </span>
        </div>
        <div className="flex flex-col text-right leading-[1.25]">
          <span className="text-[11px] font-semibold tracking-[0.03em] text-white/[0.66] uppercase">
            Te falta
          </span>
          <span className="text-[15.5px] font-bold tabular-nums">{falta}</span>
        </div>
      </div>

      <div className="relative mt-[18px] flex items-center justify-between border-t border-white/[0.16] pt-3.5">
        <span className="text-[12.5px] font-medium text-white/[0.78]">
          Préstamo de{" "}
          <strong className="font-bold text-white">{montoPrestado}</strong>
        </span>
        <span className="text-[12.5px] font-semibold text-white/[0.78]">
          Día {diaActual} de {totalDias}
        </span>
      </div>

      <div className="relative mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-white/[0.7]">
        <span aria-hidden="true">🏁</span>
        <span>
          Si seguís al día, terminás el{" "}
          <strong className="font-bold text-white">{fechaFinLarga}</strong>
        </span>
      </div>
    </section>
  );
}

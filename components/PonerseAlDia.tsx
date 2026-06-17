// Llamado claro y AMABLE: cuánto pagar hoy para quedar al día. Tono cálido
// (ámbar suave, corazón), nunca de alarma. Solo se muestra si hace falta.
export function PonerseAlDia({ monto }: { monto: string }) {
  return (
    <section className="flex items-center justify-between gap-4 rounded-[20px] border border-[#F4E3BD] bg-[linear-gradient(135deg,#FFF7E8,#FCEFCF)] px-5 py-[18px]">
      <div className="flex flex-col gap-[3px]">
        <span className="text-[11.5px] font-bold tracking-[0.04em] text-[#9A6A0E] uppercase">
          Para ponerte al día 💛
        </span>
        <span className="text-[28px] leading-none font-extrabold tracking-[-0.03em] text-[#0F1B3D] tabular-nums">
          {monto}
        </span>
        <span className="text-[12.5px] font-medium text-[#8A6B2E]">
          Con esto quedás al día con tus cuotas.
        </span>
      </div>
      <div className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-full bg-[#E8A317]/15 text-[24px]">
        🎯
      </div>
    </section>
  );
}

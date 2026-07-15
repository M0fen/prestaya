// Pantalla cuando el cliente existe pero no tiene un crédito activo.
import type { Negocio } from "@/types/cartones";
import { Footer } from "@/components/Footer";

export function SinCreditoActivo({
  nombre,
  negocio,
}: {
  nombre: string;
  negocio: Negocio;
}) {
  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
      <div className="flex w-full max-w-[440px] flex-col gap-[18px] bg-app px-[18px] pt-5 pb-10 shadow-[0_0_60px_rgba(15,27,61,0.08)]">
        <div className="-mt-1 flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-gris">Hola,</span>
          <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.03em] text-tinta">
            {nombre}
          </h1>
        </div>

        <section className="rounded-[22px] border border-[#ECEFF8] bg-white px-5 py-8 text-center shadow-[0_1px_3px_rgba(15,27,61,0.05),0_10px_26px_rgba(15,27,61,0.04)]">
          <h2 className="m-0 text-[18px] font-extrabold tracking-[-0.02em] text-tinta">
            No tenés un crédito activo
          </h2>
          <p className="mx-auto mt-2 max-w-[260px] text-[13.5px] leading-[1.5] font-medium text-gris">
            En este momento no figura ningún crédito vigente a tu nombre. Si
            creés que es un error, avisá a tu oficina.
          </p>
        </section>

        <Footer negocio={negocio} />
      </div>
    </div>
  );
}

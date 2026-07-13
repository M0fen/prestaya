// Splash de carga del cobrador: motivador en el TONO, con la paleta del sitio
// (azul de marca, mismo gradiente que el comprobante/arqueo). Se muestra dentro
// del shell (bottom-nav visible) mientras la ruta trae sus datos. Respeta reduce-motion.
import { Icono } from "@/components/Iconos";

export default function Loading() {
  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-white shadow-[0_12px_30px_rgba(19,48,140,0.3)]">
        <Icono name="apertura" className="h-8 w-8" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[18px] font-extrabold text-tinta">Ya casi…</span>
        <span className="text-[13.5px] font-medium text-gris">Preparando todo para tu día. Cada visita suma. 💪</span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="h-2 w-2 animate-pulse rounded-full bg-azul motion-reduce:animate-none" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-azul [animation-delay:160ms] motion-reduce:animate-none" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-azul [animation-delay:320ms] motion-reduce:animate-none" />
      </div>
    </div>
  );
}

// Saludo de carga de la vista del cliente: cálido y tranquilo (pensado para
// adultos mayores — grande, legible, sin apuro). Se muestra mientras se arma el
// cartón. Azul de marca + corazón. Respeta reduce-motion.
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-fondo px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-white shadow-[0_14px_34px_rgba(19,48,140,0.34)]">
        <span className="text-[34px]" aria-hidden="true">💙</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[22px] font-extrabold text-tinta">¡Hola! 👋</span>
        <span className="text-[15px] font-medium text-gris">Cargando tu cartón… un momentito.</span>
      </div>
      <div className="flex gap-2" aria-hidden="true">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-azul motion-reduce:animate-none" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-azul [animation-delay:160ms] motion-reduce:animate-none" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-azul [animation-delay:320ms] motion-reduce:animate-none" />
      </div>
    </div>
  );
}

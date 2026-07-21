// 404 amable DENTRO del segmento (app) del cobrador: al vivir acá, la frontera
// not-found queda bajo (app)/layout.tsx → conserva header + barra inferior + el
// SyncEngine (la cola offline sigue viva), y siempre ofrece volver a la ruta.
// Se dispara p. ej. cuando un cliente se reasignó a otro cobrador y el detalle
// llama notFound() (antes caía en el 404 pelado de Next, sin nav ni camino).
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-10 text-center">
      <span className="text-[34px]" aria-hidden="true">🧭</span>
      <h1 className="m-0 text-[17px] font-extrabold tracking-[-0.01em] text-tinta">
        Ese cliente ya no está en tu ruta
      </h1>
      <p className="m-0 max-w-[300px] text-[13px] leading-[1.5] font-medium text-gris">
        Puede que la oficina lo haya reasignado o dado de baja. Volvé a tu ruta para
        seguir cobrando; si tenías un cobro suyo, consultá con la oficina.
      </p>
      <Link
        href="/cobrador"
        className="mt-1 rounded-full bg-[#2453DC] px-5 py-2.5 text-[14px] font-bold text-white active:scale-[0.99]"
      >
        Volver a mi ruta
      </Link>
    </div>
  );
}

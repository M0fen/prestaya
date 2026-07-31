// Banner del producto DESTACADO en el cartón del cliente. Es el "anuncio con ver
// más detalle" que pidió el admin: una tarjeta con foto + precio + cuota que
// lleva a la tienda con el detalle (carrusel/video) ya abierto de ese producto.
// Presentacional puro (server-safe): solo un Link + datos ya resueltos.
import Link from "next/link";
import { UYU } from "@/lib/format";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";

const FREC: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};

export function TiendaBanner({
  producto,
  token,
}: {
  producto: ProductoParaCliente;
  /** Con token → tienda del cliente; sin token (demo/pública) → tienda pública. */
  token?: string | null;
}) {
  // Mismo cálculo que la vitrina: precio con interés → cuota (framing "N× $X").
  const conInteres = Math.round(producto.precio * (1 + producto.interesPct / 100));
  const cuota = producto.cuotas > 0 ? Math.ceil(conInteres / producto.cuotas) : 0;
  const oferta = producto.precioAnterior > producto.precio;
  const href = token
    ? `/c/${token}/tienda?producto=${producto.id}`
    : `/tienda?producto=${producto.id}`;

  return (
    <Link
      href={href}
      className="flex items-stretch gap-3 overflow-hidden rounded-[18px] border border-[#E6ECFA] bg-white p-2.5 shadow-[0_6px_20px_rgba(19,48,140,0.10)] active:scale-[0.99]"
    >
      {/* Foto de portada */}
      <div className="flex h-[94px] w-[94px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[#F7F9FD]">
        {producto.fotos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={producto.fotos[0]} alt={producto.nombre} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-[34px]" aria-hidden="true">🛍️</span>
        )}
      </div>

      {/* Texto */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-1">
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-[#FFF3D6] px-2 py-0.5 text-[9.5px] font-black tracking-wide text-[#8A6D1E] uppercase">⭐ Destacado</span>
          {oferta && (
            <span className="rounded-full bg-[#FDE7E7] px-2 py-0.5 text-[9.5px] font-black tracking-wide text-[#B23B3B] uppercase">Oferta</span>
          )}
        </span>
        {producto.marca && <span className="text-[10px] font-bold tracking-wide text-gris uppercase">{producto.marca}</span>}
        <span className="line-clamp-1 text-[14.5px] font-extrabold leading-tight text-tinta">{producto.nombre}</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[16px] font-black tabular-nums text-[#157A50]">{UYU(producto.precio)}</span>
          {oferta && <span className="text-[11px] font-semibold tabular-nums text-tenue line-through">{UYU(producto.precioAnterior)}</span>}
        </div>
        {producto.cuotas > 0 && cuota > 0 && (
          <span className="text-[11.5px] font-bold text-[#1E47C8]">{producto.cuotas}× {UYU(cuota)} {FREC[producto.frecuencia]}</span>
        )}
        <span className="mt-1 w-fit text-[11.5px] font-extrabold text-azul">Ver más detalle ›</span>
      </div>
    </Link>
  );
}

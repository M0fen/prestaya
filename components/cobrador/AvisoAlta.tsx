// Aviso del ALTA en la ficha del cliente: ¿ya tiene su link del cartón?
// Ocupa poco y baja de intensidad a medida que el alta avanza (pendiente →
// entregado → activo), para no competir nunca con el cobro del día.
import Link from "next/link";
import type { EstadoAlta } from "@/lib/data/acceso";

export function AvisoAlta({ clienteId, estado }: { clienteId: string; estado: EstadoAlta }) {
  const href = `/cobrador/cliente/${clienteId}/acceso`;

  if (estado === "activo") {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-2 rounded-[12px] bg-verde-suave px-3.5 py-2"
      >
        <span className="text-[12px] font-bold text-verde-osc">✓ Ya usa la app</span>
        <span className="text-[11.5px] font-semibold text-verde-osc/70">Ver su QR</span>
      </Link>
    );
  }

  if (estado === "entregado") {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-2 rounded-[12px] bg-azul-suave px-3.5 py-2"
      >
        <span className="text-[12px] font-bold text-azul">📨 Link entregado · falta que lo abra</span>
        <span className="text-[11.5px] font-semibold text-azul">Reenviar</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-[14px] border border-campo bg-tarjeta px-3.5 py-3 shadow-sm active:scale-[0.99]"
    >
      <span aria-hidden="true" className="text-[20px]">
        📱
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-extrabold text-tinta">Todavía no tiene su cartón</span>
        <span className="text-[11.5px] font-medium text-gris">
          Mostrale el QR y lo ve en su teléfono
        </span>
      </div>
      <span className="flex-shrink-0 rounded-full bg-[#1E47C8] px-3 py-1.5 text-[12px] font-bold text-white">
        Dar de alta
      </span>
    </Link>
  );
}

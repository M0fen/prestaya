// Badge de estado de una publicación (anuncio / banner). Una sola pieza, un solo
// vocabulario de colores (META_ESTADO) → todo el panel habla el mismo idioma:
// En pantalla · Programado · Vencido · Pausado.
import { META_ESTADO, type EstadoPublicacion } from "@/lib/publicacion";

export function EstadoBadge({ estado, className = "" }: { estado: EstadoPublicacion; className?: string }) {
  const m = META_ESTADO[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${className}`}
      style={{ background: m.bg, color: m.fg }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: m.fg }} />
      {m.label}
    </span>
  );
}

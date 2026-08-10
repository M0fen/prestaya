// ─────────────────────────────────────────────────────────────────────────
//  El saludo de arriba de la ruta. Todo lo que dice sale de SUS números de hoy
//  (ver lib/motivacion.ts). Server component: cero JS al teléfono.
//
//  Discreto a propósito: va ARRIBA del arqueo pero no le compite. Lo que el
//  cobrador necesita ver primero sigue siendo su plata; esto es el empujón.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import type { Motivacion } from "@/lib/motivacion";

const TONO = {
  logro: { borde: "#BEEBD5", fondo: "#F0FBF5", texto: "#157A50", suave: "#1D8A5E" },
  aliento: { borde: "#DCE6FB", fondo: "#F7F9FF", texto: "#1E47C8", suave: "#3A5BA8" },
  arranque: { borde: "#F0DCA8", fondo: "#FDF8EC", texto: "#8A6D1E", suave: "#9A7A28" },
} as const;

export function BannerMotivacion({ m }: { m: Motivacion | null }) {
  if (!m) return null;
  const t = TONO[m.tono];
  return (
    <section
      className="flex items-start gap-3 rounded-[16px] border p-4"
      style={{ borderColor: t.borde, background: t.fondo }}
    >
      <span aria-hidden className="text-[22px] leading-none">
        {m.emoji}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14.5px] leading-[1.3] font-extrabold" style={{ color: t.texto }}>
          {m.titulo}
        </span>
        <span className="text-[12.5px] leading-[1.5] font-medium tabular-nums" style={{ color: t.suave }}>
          {m.cuerpo}
        </span>
        {m.cta && (
          <Link
            href={m.cta.href}
            className="mt-1.5 min-h-11 self-start rounded-full bg-white px-4 text-[12.5px] font-bold leading-[44px] active:scale-95"
            style={{ color: t.texto, boxShadow: `inset 0 0 0 1px ${t.borde}` }}
          >
            {m.cta.texto}
          </Link>
        )}
      </div>
    </section>
  );
}

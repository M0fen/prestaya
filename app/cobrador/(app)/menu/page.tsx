// ─────────────────────────────────────────────────────────────────────────
//  MENÚ del cobrador: todo lo que no es del minuto a minuto. La barra de abajo
//  quedó para el flujo del día (Hoy · Clientes · Informes · Chat) y esto es el
//  cajón ordenado del resto — cada entrada dice PARA QUÉ sirve, porque un ícono
//  solo no le explica la app a un cobrador nuevo.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";

const SECCIONES: {
  titulo: string;
  items: { href: string; emoji: string; titulo: string; detalle: string }[];
}[] = [
  {
    titulo: "Colocar capital",
    items: [
      {
        href: "/cobrador/colocar?modo=renovar",
        emoji: "🔁",
        titulo: "Renovar",
        detalle: "El que terminó de pagar repite su crédito, de un toque",
      },
      {
        href: "/cobrador/colocar?modo=venta",
        emoji: "💵",
        titulo: "Nueva venta",
        detalle: "Elegís monto y cuotas — incluye el primer crédito del censado",
      },
      {
        href: "/cobrador/censar",
        emoji: "🧍",
        titulo: "Censar cliente nuevo",
        detalle: "Alta con foto y GPS de la casa; queda en tu ruta",
      },
    ],
  },
  {
    titulo: "Mi trabajo",
    items: [
      {
        href: "/cobrador/mis-numeros",
        emoji: "📈",
        titulo: "Mis números",
        detalle: "Comisión de la quincena, cobrado del mes, tu historial",
      },
      {
        href: "/cobrador/notas",
        emoji: "📝",
        titulo: "Notas",
        detalle: "Tus anotaciones sobre clientes",
      },
      {
        href: "/cobrador/altas",
        emoji: "🔗",
        titulo: "Entregar el cartón",
        detalle: "El link personal / QR para que el cliente vea su cartón",
      },
    ],
  },
  {
    titulo: "Ayuda",
    items: [
      {
        href: "/cobrador/tutorial",
        emoji: "🎓",
        titulo: "Cómo se usa la app",
        detalle: "El paso a paso del día, con ejemplos",
      },
    ],
  },
];

export default function MenuPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[19px] font-extrabold text-tinta">Menú</h1>
      {SECCIONES.map((s) => (
        <section key={s.titulo} className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            {s.titulo}
          </span>
          <div className="flex flex-col overflow-hidden rounded-[16px] bg-white shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
            {s.items.map((it, i) => (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-3 px-4 py-3.5 active:bg-[#F6F8FD] ${
                  i > 0 ? "border-t border-[#F0F2F9]" : ""
                }`}
              >
                <span className="text-[20px]">{it.emoji}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-bold text-tinta">{it.titulo}</span>
                  <span className="text-[11.5px] leading-[1.4] font-medium text-gris">
                    {it.detalle}
                  </span>
                </span>
                <span aria-hidden className="text-[15px] font-bold text-[#C7D0E4]">›</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

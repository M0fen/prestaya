// ─────────────────────────────────────────────────────────────────────────
//  MENÚ del cobrador: todo lo que no es del minuto a minuto. La barra de abajo
//  quedó para el flujo del día (Hoy · Clientes · Informes · Chat) y esto es el
//  cajón ordenado del resto — cada entrada dice PARA QUÉ sirve, porque un ícono
//  solo no le explica la app a un cobrador nuevo.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { cookies } from "next/headers";
import { ModoOscuro } from "@/components/admin/ModoOscuro";

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

export default async function MenuPage() {
  const tema = (await cookies()).get("tema")?.value === "oscuro" ? "oscuro" : "claro";
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[19px] font-extrabold text-tinta">Menú</h1>

      {/* Modo oscuro (08-14): para el que revisa la caja de noche. La preferencia
          es del DISPOSITIVO (cookie compartida con el panel) y el SSR la respeta. */}
      <div className="flex items-center justify-between rounded-[16px] bg-tarjeta px-4 py-3 shadow-sm">
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-bold text-tinta">Modo oscuro</span>
          <span className="text-[11.5px] leading-[1.4] font-medium text-gris">
            Para trabajar de noche sin encandilarte
          </span>
        </span>
        <ModoOscuro inicial={tema === "oscuro"} rootId="cobrador-root" />
      </div>

      {SECCIONES.map((s) => (
        <section key={s.titulo} className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            {s.titulo}
          </span>
          <div className="flex flex-col overflow-hidden rounded-[16px] bg-tarjeta shadow-sm">
            {s.items.map((it, i) => (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-3 px-4 py-3.5 active:bg-app ${
                  i > 0 ? "border-t border-linea" : ""
                }`}
              >
                <span className="text-[20px]">{it.emoji}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-bold text-tinta">{it.titulo}</span>
                  <span className="text-[11.5px] leading-[1.4] font-medium text-gris">
                    {it.detalle}
                  </span>
                </span>
                <span aria-hidden className="text-[15px] font-bold text-campo">›</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

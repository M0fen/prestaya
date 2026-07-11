"use client";
// Barra de navegación INFERIOR del cobrador (mobile-first — la usa a una mano en
// la calle). Pone los destinos del día al alcance del pulgar y libera el header
// (antes: 4 íconos de 36px apretados arriba a la derecha). Fija abajo, respeta el
// safe-area (home indicator); centrada al ancho de la columna (max-w-480).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreIcono } from "@/components/Iconos";

const TABS: { href: string; label: string; icon: NombreIcono; badge?: boolean }[] = [
  { href: "/cobrador", label: "Ruta", icon: "ruta" },
  { href: "/cobrador/chat", label: "Chat", icon: "chat", badge: true },
  { href: "/cobrador/mis-numeros", label: "Números", icon: "numeros" },
  { href: "/cobrador/notas", label: "Notas", icon: "notas" },
  { href: "/cobrador/tutorial", label: "Ayuda", icon: "ayuda" },
];

export function CobradorBottomNav({ noLeidos = 0 }: { noLeidos?: number }) {
  const pathname = usePathname();
  // "Ruta" solo activa en la home exacta; el resto por prefijo (incluye subrutas).
  const activo = (href: string) =>
    href === "/cobrador" ? pathname === "/cobrador" : pathname.startsWith(href);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[480px] border-t border-white/10 bg-[#0F1B3D] pb-safe">
      {TABS.map((t) => {
        const on = activo(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-label={t.label}
            className={`relative flex flex-1 flex-col items-center gap-0.5 pt-2.5 pb-1.5 text-[10px] font-bold active:bg-white/5 ${
              on ? "text-white" : "text-white/45"
            }`}
          >
            {on && <span aria-hidden="true" className="absolute top-0 h-[3px] w-9 rounded-full bg-[#6B8FF7]" />}
            <span className="relative leading-none">
              <Icono name={t.icon} className="h-[22px] w-[22px]" />
              {t.badge && noLeidos > 0 && (
                <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#E06A6A] px-1 text-[9px] font-black text-white">
                  {noLeidos > 9 ? "9+" : noLeidos}
                </span>
              )}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

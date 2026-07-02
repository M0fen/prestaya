"use client";
// Navegación del panel. Resalta la sección activa y oculta lo que el rol no
// puede ver. Los ítems marcados `pronto` se muestran deshabilitados (roadmap).
// La lista vive en lib/admin/nav.ts (compartida con el CommandPalette).
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Rol } from "@/types/db";
import { navVisible } from "@/lib/admin/nav";

export function SidebarNav({ rol, noLeidos = 0 }: { rol: Rol; noLeidos?: number }) {
  const pathname = usePathname();
  const visibles = navVisible(rol);

  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
      {visibles.map((item) => {
        const activo =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        if (item.pronto) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              className="flex flex-shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold text-white/35"
            >
              <span aria-hidden="true" className="text-[15px]">
                {item.icon}
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
              <span className="ml-auto hidden rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-white/45 uppercase md:inline">
                Pronto
              </span>
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
              activo
                ? "bg-white/15 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span aria-hidden="true" className="text-[15px]">
              {item.icon}
            </span>
            <span className="whitespace-nowrap">{item.label}</span>
            {item.href === "/admin/chat" && noLeidos > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E06A6A] px-1.5 text-[10px] font-black text-white">
                {noLeidos > 9 ? "9+" : noLeidos}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

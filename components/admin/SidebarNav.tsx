"use client";
// Navegación del panel. Resalta la sección activa y oculta lo que el rol no
// puede ver. Los ítems marcados `pronto` se muestran deshabilitados (roadmap).
// La lista vive en lib/admin/nav.ts (compartida con el CommandPalette).
//
// Dos layouts desde la MISMA lista:
//  · Mobile: franja horizontal plana (scroll-x), como siempre.
//  · Escritorio (md+): secciones COLAPSABLES (<details>) para domar 30+ ítems.
//    La sección con la ruta activa abre sola; el badge de chat sin leer burbujea
//    al encabezado de su grupo si está colapsado (no se pierde la señal).
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Rol } from "@/types/db";
import { navAgrupado, type NavItem } from "@/lib/admin/nav";

export function SidebarNav({
  rol,
  noLeidos = 0,
  esDev = false,
}: {
  rol: Rol;
  noLeidos?: number;
  esDev?: boolean;
}) {
  const pathname = usePathname();
  const { suelto, grupos } = navAgrupado(rol, esDev);

  const esActivo = (item: NavItem) =>
    item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);

  return (
    <>
      {/* Solo escritorio: Dashboard suelto + secciones colapsables. En mobile la
          navegación es el PanelBottomNav (barra inferior). */}
      <nav className="hidden flex-col gap-0.5 p-3 md:flex">
        {suelto.map((item) => (
          <ItemLink key={item.href} item={item} activo={esActivo(item)} noLeidos={noLeidos} />
        ))}
        {grupos.map(({ grupo, items }) => {
          const tieneActivo = items.some((i) => esActivo(i));
          // Chat sin leer dentro de este grupo (para burbujear al encabezado).
          const chatOculto = noLeidos > 0 && items.some((i) => i.href === "/admin/chat");
          return (
            <details key={grupo} open={tieneActivo} className="group mt-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 py-2 text-[11px] font-bold tracking-wide text-white/45 uppercase select-none hover:text-white/70">
                <span>{grupo}</span>
                {chatOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E06A6A] group-open:hidden" />
                )}
                <span aria-hidden="true" className="ml-auto text-[10px] text-white/35 transition-transform group-open:rotate-90">
                  ▶
                </span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {items.map((item) => (
                  <ItemLink key={item.href} item={item} activo={esActivo(item)} noLeidos={noLeidos} />
                ))}
              </div>
            </details>
          );
        })}
      </nav>
    </>
  );
}

/** Un ítem de navegación (link activo/inactivo, o span deshabilitado si `pronto`). */
function ItemLink({
  item,
  activo,
  noLeidos,
}: {
  item: NavItem;
  activo: boolean;
  noLeidos: number;
}) {
  if (item.pronto) {
    return (
      <span
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
      href={item.href}
      className={`flex flex-shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
        activo ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
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
}

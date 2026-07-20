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
import { Icono, ICONO_NAV } from "@/components/Iconos";

export function SidebarNav({
  rol,
  noLeidos = 0,
  gastosPendientes = 0,
  leadsNuevos = 0,
  esDev = false,
}: {
  rol: Rol;
  noLeidos?: number;
  gastosPendientes?: number;
  leadsNuevos?: number;
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
          <ItemLink key={item.href} item={item} activo={esActivo(item)} noLeidos={noLeidos} gastosPendientes={gastosPendientes} leadsNuevos={leadsNuevos} />
        ))}
        {grupos.map(({ grupo, items }) => {
          const tieneActivo = items.some((i) => esActivo(i));
          // Señales dentro del grupo, para burbujear al encabezado si está colapsado.
          const chatOculto = noLeidos > 0 && items.some((i) => i.href === "/admin/chat");
          const gastosOculto = gastosPendientes > 0 && items.some((i) => i.href === "/admin/gastos");
          const leadsOculto = leadsNuevos > 0 && items.some((i) => i.href === "/admin/tienda");
          return (
            <details key={grupo} open={tieneActivo} className="group mt-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 py-2 text-[11px] font-bold tracking-wide text-white/45 uppercase select-none hover:text-white/70">
                <span>{grupo}</span>
                {chatOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E06A6A] group-open:hidden" />
                )}
                {gastosOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E8A317] group-open:hidden" />
                )}
                {leadsOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1FA971] group-open:hidden" />
                )}
                <span aria-hidden="true" className="ml-auto text-[10px] text-white/35 transition-transform group-open:rotate-90">
                  ▶
                </span>
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {items.map((item) => (
                  <ItemLink key={item.href} item={item} activo={esActivo(item)} noLeidos={noLeidos} gastosPendientes={gastosPendientes} leadsNuevos={leadsNuevos} />
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
  gastosPendientes,
  leadsNuevos,
}: {
  item: NavItem;
  activo: boolean;
  noLeidos: number;
  gastosPendientes: number;
  leadsNuevos: number;
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
      {ICONO_NAV[item.href] ? (
        <Icono name={ICONO_NAV[item.href]} className="h-4 w-4 flex-shrink-0" />
      ) : (
        <span aria-hidden="true" className="text-[15px]">
          {item.icon}
        </span>
      )}
      <span className="whitespace-nowrap">{item.label}</span>
      {item.href === "/admin/chat" && noLeidos > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E06A6A] px-1.5 text-[10px] font-black text-white">
          {noLeidos > 9 ? "9+" : noLeidos}
        </span>
      )}
      {item.href === "/admin/gastos" && gastosPendientes > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#E8A317] px-1.5 text-[10px] font-black text-[#0F1B3D]">
          {gastosPendientes > 9 ? "9+" : gastosPendientes}
        </span>
      )}
      {item.href === "/admin/tienda" && leadsNuevos > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1FA971] px-1.5 text-[10px] font-black text-white">
          {leadsNuevos > 9 ? "9+" : leadsNuevos}
        </span>
      )}
    </Link>
  );
}

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
  anulacionesPendientes = 0,
  renovacionesPendientes = 0,
  leadsNuevos = 0,
  incidenciasAbiertas = 0,
  esDev = false,
}: {
  rol: Rol;
  noLeidos?: number;
  gastosPendientes?: number;
  anulacionesPendientes?: number;
  renovacionesPendientes?: number;
  leadsNuevos?: number;
  incidenciasAbiertas?: number;
  esDev?: boolean;
}) {
  const badges = { gastosPendientes, anulacionesPendientes, renovacionesPendientes, leadsNuevos, incidenciasAbiertas, noLeidos };
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
          <ItemLink key={item.href} item={item} activo={esActivo(item)} badges={badges} />
        ))}
        {grupos.map(({ grupo, items }) => {
          const tieneActivo = items.some((i) => esActivo(i));
          // Señales dentro del grupo, para burbujear al encabezado si está colapsado.
          const chatOculto = noLeidos > 0 && items.some((i) => i.href === "/admin/chat");
          const gastosOculto = gastosPendientes > 0 && items.some((i) => i.href === "/admin/gastos");
          const anulOculto = anulacionesPendientes > 0 && items.some((i) => i.href === "/admin/anulaciones");
          const renovOculto = renovacionesPendientes > 0 && items.some((i) => i.href === "/admin/renovaciones");
          const leadsOculto = leadsNuevos > 0 && items.some((i) => i.href === "/admin/tienda");
          const incidenciasOculto = incidenciasAbiertas > 0 && items.some((i) => i.href === "/admin/incidencias");
          return (
            <details key={grupo} open={tieneActivo} className="group mt-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[12px] px-3 py-2 text-[11px] font-bold tracking-wide text-white/45 uppercase select-none hover:text-white/70">
                <span>{grupo}</span>
                {chatOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E06A6A] group-open:hidden" />
                )}
                {gastosOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E8A317] group-open:hidden" />
                )}
                {anulOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E06A6A] group-open:hidden" />
                )}
                {renovOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#6B8FF7] group-open:hidden" />
                )}
                {leadsOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1FA971] group-open:hidden" />
                )}
                {incidenciasOculto && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E06A6A] group-open:hidden" />
                )}
                <Icono
                  name="chevron"
                  className="ml-auto h-3 w-3 text-white/35 transition-transform group-open:rotate-90"
                />
              </summary>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {items.map((item) => (
                  <ItemLink key={item.href} item={item} activo={esActivo(item)} badges={badges} />
                ))}
              </div>
            </details>
          );
        })}
      </nav>
    </>
  );
}

type Badges = {
  gastosPendientes: number;
  anulacionesPendientes: number;
  renovacionesPendientes: number;
  leadsNuevos: number;
  incidenciasAbiertas: number;
  noLeidos: number;
};

/** Badge (conteo + color) que corresponde a una ruta del nav, o null. */
function badgeDe(href: string, b: Badges): { n: number; bg: string; fg: string } | null {
  switch (href) {
    case "/admin/chat": return { n: b.noLeidos, bg: "#E06A6A", fg: "#fff" };
    case "/admin/gastos": return { n: b.gastosPendientes, bg: "#E8A317", fg: "#0F1B3D" };
    case "/admin/anulaciones": return { n: b.anulacionesPendientes, bg: "#E06A6A", fg: "#fff" }; // dinero → rojo
    case "/admin/renovaciones": return { n: b.renovacionesPendientes, bg: "#6B8FF7", fg: "#fff" };
    case "/admin/tienda": return { n: b.leadsNuevos, bg: "#1FA971", fg: "#fff" };
    case "/admin/incidencias": return { n: b.incidenciasAbiertas, bg: "#E06A6A", fg: "#fff" };
    default: return null;
  }
}

/** Un ítem de navegación (link activo/inactivo, o span deshabilitado si `pronto`). */
function ItemLink({ item, activo, badges }: { item: NavItem; activo: boolean; badges: Badges }) {
  if (item.pronto) {
    return (
      <span
        aria-disabled="true"
        className="flex flex-shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[13.5px] font-semibold text-white/35"
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

  const badge = badgeDe(item.href, badges);
  return (
    <Link
      href={item.href}
      className={`flex flex-shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
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
      {badge && badge.n > 0 && (
        <span
          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.n > 9 ? "9+" : badge.n}
        </span>
      )}
    </Link>
  );
}

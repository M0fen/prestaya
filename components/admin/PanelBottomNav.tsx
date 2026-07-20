"use client";
// Barra de navegación INFERIOR del panel, solo mobile (md:hidden). Reemplaza la
// franja de scroll horizontal (poco descubrible, lejos del pulgar) por 4 destinos
// del flujo diario + "Menú" (hoja deslizable con TODA la navegación agrupada).
// Fija abajo, respeta el safe-area (home indicator). Reusa lib/admin/nav.ts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Rol } from "@/types/db";
import { navVisible, navAgrupado, ordenSuelto } from "@/lib/admin/nav";
import { Icono, ICONO_NAV, type NombreIcono } from "@/components/Iconos";

/** Destinos del flujo diario en la barra inferior (orden = importancia). Se
 *  muestran solo los que el rol puede ver. El 5º slot es siempre "Menú". */
const TABS: { href: string; label: string; icon: NombreIcono }[] = [
  { href: "/admin", label: "Inicio", icon: "inicio" },
  { href: "/admin/jornada", label: "Jornada", icon: "jornada" },
  { href: "/admin/cobranza", label: "Cobranza", icon: "cobranza" },
  { href: "/admin/caja", label: "Caja", icon: "caja" },
];

export function PanelBottomNav({
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
  const [abierto, setAbierto] = useState(false);
  const visibles = new Set(navVisible(rol, esDev).map((i) => i.href));
  // Mismo orden por rol que el sidebar: el supervisor ve "Jornada" antes que
  // "Inicio". Solo reordena esos dos; Cobranza/Caja quedan detrás como están.
  const orden = ordenSuelto(rol);
  const rank = (href: string) => {
    const k = orden.indexOf(href);
    return k === -1 ? orden.length : k;
  };
  const tabs = TABS.filter((t) => visibles.has(t.href)).sort(
    (a, b) => rank(a.href) - rank(b.href),
  );
  const { suelto, grupos } = navAgrupado(rol, esDev);
  const activo = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <>
      {/* Barra inferior fija (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-[#0F1B3D] pb-safe md:hidden">
        {tabs.map((t) => {
          const on = activo(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 pt-2.5 pb-1.5 text-[10px] font-bold ${on ? "text-white" : "text-white/45"}`}
            >
              {on && <span aria-hidden="true" className="absolute top-0 h-[3px] w-9 rounded-full bg-[#6B8FF7]" />}
              <Icono name={t.icon} className="h-[22px] w-[22px]" />
              {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir menú"
          className="flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-bold text-white/50"
        >
          <span className="relative leading-none">
            <Icono name="menu" className="h-[22px] w-[22px]" />
            {(noLeidos > 0 || gastosPendientes > 0 || leadsNuevos > 0) && (
              <span
                className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full"
                style={{ background: noLeidos > 0 ? "#E06A6A" : gastosPendientes > 0 ? "#E8A317" : "#1FA971" }}
              />
            )}
          </span>
          Menú
        </button>
      </nav>

      {/* Hoja con TODA la navegación (mobile) */}
      {abierto && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55 md:hidden"
          onClick={() => setAbierto(false)}
        >
          <div
            className="max-h-[82vh] overflow-y-auto rounded-t-[22px] bg-[#0F1B3D] px-3 pt-3 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-[13px] font-extrabold text-white">Menú</span>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-full px-2 text-[20px] leading-none text-white/60"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-0.5 pb-3">
              {suelto.map((i) => (
                <ItemSheet key={i.href} href={i.href} icon={i.icon} label={i.label} activo={activo(i.href)} onNav={() => setAbierto(false)} />
              ))}
              {grupos.map(({ grupo, items }) => (
                <div key={grupo} className="mt-2">
                  <span className="px-3 text-[10px] font-bold uppercase tracking-wide text-white/40">{grupo}</span>
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {items.map((i) => (
                      <ItemSheet
                        key={i.href}
                        href={i.href}
                        icon={i.icon}
                        label={i.label}
                        activo={activo(i.href)}
                        badge={i.href === "/admin/chat" ? noLeidos : i.href === "/admin/gastos" ? gastosPendientes : i.href === "/admin/tienda" ? leadsNuevos : 0}
                        amber={i.href === "/admin/gastos"}
                        green={i.href === "/admin/tienda"}
                        onNav={() => setAbierto(false)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ItemSheet({
  href,
  icon,
  label,
  activo,
  badge = 0,
  amber = false,
  green = false,
  onNav,
}: {
  href: string;
  icon: string;
  label: string;
  activo: boolean;
  badge?: number;
  amber?: boolean;
  green?: boolean;
  onNav: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNav}
      className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-semibold ${activo ? "bg-white/15 text-white" : "text-white/75 active:bg-white/10"}`}
    >
      {ICONO_NAV[href] ? (
        <Icono name={ICONO_NAV[href]} className="h-[18px] w-[18px]" />
      ) : (
        <span aria-hidden="true" className="text-[17px]">{icon}</span>
      )}
      <span>{label}</span>
      {badge > 0 && (
        <span
          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black"
          style={amber ? { background: "#E8A317", color: "#0F1B3D" } : green ? { background: "#1FA971", color: "#fff" } : { background: "#E06A6A", color: "#fff" }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

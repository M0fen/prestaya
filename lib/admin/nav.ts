// ─────────────────────────────────────────────────────────────────────────
//  Fuente ÚNICA de la navegación del panel. La usan el SidebarNav (barra) y el
//  CommandPalette (Ctrl/Cmd+K). Así no se desincronizan las secciones ni los
//  permisos por rol.
// ─────────────────────────────────────────────────────────────────────────
import type { Rol } from "@/types/db";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Roles que lo ven. Si se omite, lo ven todos. */
  roles?: Rol[];
  /** Deshabilitado (en el roadmap): se muestra pero no navega. */
  pronto?: boolean;
  /** Sinónimos para la búsqueda del command palette. */
  alias?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "▣", alias: ["inicio", "tablero", "resumen"] },
  { href: "/admin/chat", label: "Chat", icon: "💬", alias: ["mensajes"] },
  { href: "/admin/notas", label: "Notas", icon: "📝" },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️", roles: ["admin", "supervisor"], alias: ["mapa", "geo", "cobros"] },
  { href: "/admin/valor", label: "Valor", icon: "💎", roles: ["admin", "supervisor"], alias: ["roi", "rentabilidad"] },
  { href: "/admin/renovaciones", label: "Renovaciones", icon: "🔄", roles: ["admin", "supervisor"], alias: ["renovar", "recredito"] },
  { href: "/admin/juego", label: "Zona de juego", icon: "🎮", roles: ["admin", "supervisor"], alias: ["gaming", "mascota", "recompensas", "temporada"] },
  { href: "/admin/mora", label: "Mora", icon: "⏰", roles: ["admin", "supervisor"], alias: ["atrasos", "morosos", "riesgo", "recargo"] },
  { href: "/admin/clientes", label: "Clientes", icon: "👤", roles: ["admin", "supervisor"], alias: ["deudores", "cartera"] },
  { href: "/admin/creditos", label: "Créditos", icon: "📄", pronto: true },
  { href: "/admin/caja", label: "Caja", icon: "💵", roles: ["admin", "supervisor"], alias: ["arqueo", "rendiciones", "movimientos"] },
  { href: "/admin/comisiones", label: "Comisiones", icon: "📊", roles: ["admin", "supervisor"], alias: ["liquidacion", "cobradores"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🧾", roles: ["admin", "supervisor"], alias: ["log", "registro", "acciones"] },
  { href: "/admin/reportes", label: "Reportes", icon: "📨", roles: ["admin", "supervisor"], pronto: true },
  { href: "/admin/anuncios", label: "Anuncios", icon: "📣", roles: ["admin", "supervisor"], pronto: true },
  { href: "/admin/equipo", label: "Equipo", icon: "🧑‍🤝‍🧑", roles: ["admin"], pronto: true },
];

/** Ítems visibles para un rol dado. */
export function navVisible(rol: Rol): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(rol));
}

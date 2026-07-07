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
  { href: "/admin/cierre", label: "Cierre del día", icon: "🌅", roles: ["admin", "supervisor"], alias: ["cierre", "jornada", "operacion", "en vivo", "meta", "proyeccion", "hoy"] },
  { href: "/admin/chat", label: "Chat", icon: "💬", alias: ["mensajes"] },
  { href: "/admin/notas", label: "Notas", icon: "📝" },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️", roles: ["admin", "supervisor"], alias: ["mapa", "geo", "cobros"] },
  { href: "/admin/valor", label: "Valor", icon: "💎", roles: ["admin", "supervisor"], alias: ["roi", "rentabilidad"] },
  { href: "/admin/renovaciones", label: "Renovaciones", icon: "🔄", roles: ["admin", "supervisor"], alias: ["renovar", "recredito"] },
  { href: "/admin/juego", label: "Zona de juego", icon: "🎮", roles: ["admin", "supervisor"], alias: ["gaming", "recompensas", "temporada", "caritas"] },
  { href: "/admin/estrellas", label: "Estrellas", icon: "⭐", roles: ["admin", "supervisor"], alias: ["canjes", "redenciones", "premios"] },
  { href: "/admin/promos", label: "Juegos y sorteos", icon: "🎟️", roles: ["admin", "supervisor"], alias: ["raspadita", "quiniela", "sorteo", "promocion"] },
  { href: "/admin/mora", label: "Mora", icon: "⏰", roles: ["admin", "supervisor"], alias: ["atrasos", "morosos", "riesgo", "recargo"] },
  { href: "/admin/clientes", label: "Clientes", icon: "👤", roles: ["admin", "supervisor"], alias: ["deudores", "cartera"] },
  { href: "/admin/scoring", label: "Scoring", icon: "🧮", roles: ["admin"], alias: ["riesgo", "modelo", "puntaje", "credit score", "pesos", "umbrales"] },
  { href: "/admin/creditos", label: "Créditos", icon: "📄", pronto: true },
  { href: "/admin/caja", label: "Caja", icon: "💵", roles: ["admin", "supervisor"], alias: ["arqueo", "rendiciones", "movimientos"] },
  { href: "/admin/comisiones", label: "Comisiones", icon: "📊", roles: ["admin", "supervisor"], alias: ["liquidacion", "cobradores"] },
  { href: "/admin/campo", label: "Control de campo", icon: "🛰️", roles: ["admin", "supervisor"], alias: ["cobradores", "gps", "bitacora", "sospecha", "planchado", "malas mañas"] },
  { href: "/admin/anulaciones", label: "Anulaciones", icon: "🚫", roles: ["admin", "supervisor"], alias: ["anular", "anulacion", "doble registro", "reversar", "pago"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🧾", roles: ["admin", "supervisor"], alias: ["log", "registro", "acciones"] },
  { href: "/admin/reportes", label: "Reportes", icon: "📨", roles: ["admin", "supervisor"], alias: ["exportar", "csv", "excel", "descargar", "estado de cuenta", "pdf", "respaldo", "backup"] },
  { href: "/admin/anuncios", label: "Anuncios", icon: "📣", roles: ["admin", "supervisor"], alias: ["publicidad", "campanas", "banner", "temporada"] },
  { href: "/admin/zonas", label: "Zonas", icon: "🗺️", roles: ["admin"], alias: ["territorio", "barrio", "ruta", "sector", "cobradores", "supervisor"] },
  { href: "/admin/equipo", label: "Equipo", icon: "🧑‍🤝‍🧑", roles: ["admin"], alias: ["permisos", "roles", "supervisora", "esposa", "usuarios"] },
  { href: "/admin/tutorial", label: "Cómo se usa", icon: "🎓", alias: ["tutorial", "ayuda", "guia", "manual", "instrucciones", "aprender"] },
  { href: "/admin/seguridad", label: "Seguridad", icon: "🔐", alias: ["2fa", "dos pasos", "mfa", "totp", "contraseña", "verificacion"] },
];

/** Ítems visibles para un rol dado. */
export function navVisible(rol: Rol): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(rol));
}

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
  /** Solo visible para desarrolladores (es_dev). */
  dev?: boolean;
  /** Sinónimos para la búsqueda del command palette. */
  alias?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "▣", alias: ["inicio", "tablero", "resumen"] },
  { href: "/admin/alertas", label: "Centro de alertas", icon: "🚨", roles: ["admin", "supervisor"], alias: ["vigilancia", "fuga", "confianza cobrador", "sospecha", "faltante", "riesgo", "no pago"] },
  { href: "/admin/cierre", label: "Cierre del día", icon: "🌅", roles: ["admin", "supervisor"], alias: ["cierre", "jornada", "operacion", "en vivo", "meta", "proyeccion", "hoy"] },
  { href: "/admin/chat", label: "Chat", icon: "💬", alias: ["mensajes"] },
  { href: "/admin/notas", label: "Notas", icon: "📝" },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️", roles: ["admin", "supervisor"], alias: ["mapa", "geo", "cobros"] },
  { href: "/admin/valor", label: "Valor", icon: "💎", roles: ["admin"], alias: ["roi", "rentabilidad"] },
  { href: "/admin/renovaciones", label: "Renovaciones", icon: "🔄", roles: ["admin", "supervisor"], alias: ["renovar", "recredito"] },
  { href: "/admin/juego", label: "Zona de juego", icon: "🎮", roles: ["admin", "supervisor"], alias: ["gaming", "recompensas", "temporada", "caritas"] },
  { href: "/admin/estrellas", label: "Estrellas", icon: "⭐", roles: ["admin", "supervisor"], alias: ["canjes", "redenciones", "premios"] },
  { href: "/admin/promos", label: "Juegos y sorteos", icon: "🎟️", roles: ["admin", "supervisor"], alias: ["raspadita", "quiniela", "sorteo", "promocion"] },
  { href: "/admin/rifa", label: "Rifa", icon: "🎁", roles: ["admin"], alias: ["premio", "sorteo", "banner", "mejores clientes"] },
  { href: "/admin/mora", label: "Mora", icon: "⏰", roles: ["admin", "supervisor"], alias: ["atrasos", "morosos", "riesgo", "recargo"] },
  { href: "/admin/clientes", label: "Clientes", icon: "👤", roles: ["admin", "supervisor"], alias: ["deudores", "cartera"] },
  { href: "/admin/scoring", label: "Scoring", icon: "🧮", roles: ["admin"], alias: ["riesgo", "modelo", "puntaje", "credit score", "pesos", "umbrales"] },
  { href: "/admin/recaudos", label: "Recaudos", icon: "💵", roles: ["admin", "supervisor"], alias: ["pagos", "cobros", "recaudo diario"] },
  { href: "/admin/caja", label: "Caja diaria", icon: "💰", roles: ["admin", "supervisor"], alias: ["arqueo", "rendiciones", "movimientos", "caja", "gastos"] },
  { href: "/admin/capital", label: "Inversión de capital", icon: "🏦", roles: ["admin"], alias: ["capital", "aportes", "inversion"] },
  { href: "/admin/comisiones", label: "Comisiones", icon: "📊", roles: ["admin"], alias: ["liquidacion", "cobradores"] },
  { href: "/admin/recibos", label: "Recibos", icon: "🧾", roles: ["admin"], alias: ["factura", "comprobante", "pago", "sueldo", "adelanto", "trabajador"] },
  { href: "/admin/informe-cartera", label: "Ventas Crédito", icon: "💳", roles: ["admin"], alias: ["creditos", "cartera", "interes", "utilidad", "deuda", "ventas a hoy", "con intereses", "recaudo", "informe"] },
  { href: "/admin/campo", label: "Control de campo", icon: "🛰️", roles: ["admin", "supervisor"], alias: ["cobradores", "gps", "bitacora", "sospecha", "planchado", "malas mañas"] },
  { href: "/admin/anulaciones", label: "Anulaciones", icon: "🚫", roles: ["admin", "supervisor"], alias: ["anular", "anulacion", "doble registro", "reversar", "pago"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🧾", roles: ["admin", "supervisor"], alias: ["log", "registro", "acciones"] },
  { href: "/admin/reportes", label: "Reportes", icon: "📨", roles: ["admin"], alias: ["exportar", "csv", "excel", "descargar", "estado de cuenta", "pdf", "respaldo", "backup"] },
  { href: "/admin/anuncios", label: "Anuncios", icon: "📣", roles: ["admin", "supervisor"], alias: ["publicidad", "campanas", "banner", "temporada"] },
  { href: "/admin/zonas", label: "Zonas", icon: "🗺️", roles: ["admin"], alias: ["territorio", "barrio", "ruta", "sector", "cobradores", "supervisor"] },
  { href: "/admin/equipo", label: "Equipo", icon: "🧑‍🤝‍🧑", roles: ["admin"], alias: ["permisos", "roles", "supervisora", "esposa", "usuarios"] },
  { href: "/admin/tutorial", label: "Cómo se usa", icon: "🎓", alias: ["tutorial", "ayuda", "guia", "manual", "instrucciones", "aprender"] },
  { href: "/admin/seguridad", label: "Seguridad", icon: "🔐", alias: ["2fa", "dos pasos", "mfa", "totp", "contraseña", "verificacion"] },
  { href: "/admin/dev", label: "Dev", icon: "🛠️", dev: true, alias: ["diagnostico", "salud", "sistema", "debug", "desarrollador", "estado"] },
];

/** Ítems visibles para un rol dado (y si es desarrollador, los ítems dev). */
export function navVisible(rol: Rol, esDev = false): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (i.dev) return esDev;
    return !i.roles || i.roles.includes(rol);
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  Fuente ÚNICA de la navegación del panel. La usan el SidebarNav (barra) y el
//  CommandPalette (Ctrl/Cmd+K). Así no se desincronizan las secciones ni los
//  permisos por rol.
// ─────────────────────────────────────────────────────────────────────────
import type { Rol } from "@/types/db";

/** Secciones del menú, en orden de importancia operativa. La franja mobile las
 *  ignora (tira plana); el sidebar de escritorio las agrupa en colapsables. */
export type Grupo =
  | "Operación diaria"
  | "Cartera y clientes"
  | "Finanzas y análisis"
  | "Fidelización"
  | "Comunicación"
  | "Configuración";

export const NAV_GRUPOS: Grupo[] = [
  "Operación diaria",
  "Cartera y clientes",
  "Finanzas y análisis",
  "Fidelización",
  "Comunicación",
  "Configuración",
];

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Sección del menú (para el sidebar agrupado). Dashboard queda suelto arriba. */
  grupo?: Grupo;
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
  // ── Operación diaria (el control del dinero, de un vistazo) ──
  { href: "/admin/alertas", label: "Centro de alertas", icon: "🚨", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["vigilancia", "fuga", "confianza cobrador", "sospecha", "faltante", "riesgo", "no pago"] },
  { href: "/admin/cierre", label: "Cierre del día", icon: "🌅", grupo: "Operación diaria", roles: ["admin"], alias: ["cierre", "jornada", "operacion", "en vivo", "meta", "proyeccion", "hoy"] },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["mapa", "geo", "cobros"] },
  { href: "/admin/recaudos", label: "Recaudos", icon: "💵", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["pagos", "cobros", "recaudo diario"] },
  { href: "/admin/caja", label: "Caja diaria", icon: "💰", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["arqueo", "rendiciones", "movimientos", "caja", "gastos"] },
  { href: "/admin/mora", label: "Mora", icon: "⏰", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["atrasos", "morosos", "riesgo", "recargo"] },
  { href: "/admin/campo", label: "Control de campo", icon: "🛰️", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["cobradores", "gps", "bitacora", "sospecha", "planchado", "malas mañas"] },
  { href: "/admin/anulaciones", label: "Anulaciones", icon: "🚫", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["anular", "anulacion", "doble registro", "reversar", "pago"] },
  // ── Cartera y clientes ──
  { href: "/admin/clientes", label: "Clientes", icon: "👤", grupo: "Cartera y clientes", roles: ["admin", "supervisor"], alias: ["deudores", "cartera"] },
  { href: "/admin/informe-cartera", label: "Ventas Crédito", icon: "💳", grupo: "Cartera y clientes", roles: ["admin"], alias: ["creditos", "cartera", "interes", "utilidad", "deuda", "ventas a hoy", "con intereses", "recaudo", "informe"] },
  { href: "/admin/renovaciones", label: "Renovaciones", icon: "🔄", grupo: "Cartera y clientes", roles: ["admin", "supervisor"], alias: ["renovar", "recredito"] },
  { href: "/admin/scoring", label: "Scoring", icon: "🧮", grupo: "Cartera y clientes", roles: ["admin"], alias: ["riesgo", "modelo", "puntaje", "credit score", "pesos", "umbrales"] },
  // ── Finanzas y análisis ──
  { href: "/admin/estadisticas", label: "Estadísticas", icon: "📈", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["stats", "crecimiento", "cohortes", "tendencias", "colocacion", "distribucion", "comportamiento", "metricas"] },
  { href: "/admin/valor", label: "Valor", icon: "💎", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["roi", "rentabilidad"] },
  { href: "/admin/comisiones", label: "Comisiones", icon: "📊", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["liquidacion", "cobradores"] },
  { href: "/admin/capital", label: "Inversión de capital", icon: "🏦", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["capital", "aportes", "inversion"] },
  { href: "/admin/reportes", label: "Reportes", icon: "📨", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["exportar", "csv", "excel", "descargar", "estado de cuenta", "pdf", "respaldo", "backup"] },
  // ── Fidelización (juegos y comunicación al cliente) ──
  { href: "/admin/juego", label: "Zona de juego", icon: "🎮", grupo: "Fidelización", roles: ["admin", "supervisor"], alias: ["gaming", "recompensas", "temporada", "caritas"] },
  { href: "/admin/estrellas", label: "Estrellas", icon: "⭐", grupo: "Fidelización", roles: ["admin", "supervisor"], alias: ["canjes", "redenciones", "premios"] },
  { href: "/admin/promos", label: "Juegos y sorteos", icon: "🎟️", grupo: "Fidelización", roles: ["admin", "supervisor"], alias: ["raspadita", "quiniela", "sorteo", "promocion"] },
  { href: "/admin/rifa", label: "Rifa", icon: "🎁", grupo: "Fidelización", roles: ["admin"], alias: ["premio", "sorteo", "banner", "mejores clientes"] },
  { href: "/admin/anuncios", label: "Anuncios", icon: "📣", grupo: "Fidelización", roles: ["admin", "supervisor"], alias: ["publicidad", "campanas", "banner", "temporada"] },
  // ── Comunicación interna ──
  { href: "/admin/chat", label: "Chat", icon: "💬", grupo: "Comunicación", alias: ["mensajes"] },
  { href: "/admin/notas", label: "Notas", icon: "📝", grupo: "Comunicación" },
  // ── Configuración ──
  { href: "/admin/zonas", label: "Zonas", icon: "🗺️", grupo: "Configuración", roles: ["admin"], alias: ["territorio", "barrio", "ruta", "sector", "cobradores", "supervisor"] },
  { href: "/admin/equipo", label: "Equipo", icon: "🧑‍🤝‍🧑", grupo: "Configuración", roles: ["admin"], alias: ["permisos", "roles", "supervisora", "esposa", "usuarios"] },
  { href: "/admin/recibos", label: "Recibos", icon: "🧾", grupo: "Configuración", roles: ["admin"], alias: ["factura", "comprobante", "pago", "sueldo", "adelanto", "trabajador"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🧾", grupo: "Configuración", roles: ["admin", "supervisor"], alias: ["log", "registro", "acciones"] },
  { href: "/admin/tutorial", label: "Cómo se usa", icon: "🎓", grupo: "Configuración", alias: ["tutorial", "ayuda", "guia", "manual", "instrucciones", "aprender"] },
  { href: "/admin/seguridad", label: "Seguridad", icon: "🔐", grupo: "Configuración", alias: ["2fa", "dos pasos", "mfa", "totp", "contraseña", "verificacion"] },
  { href: "/admin/dev", label: "Dev", icon: "🛠️", grupo: "Configuración", dev: true, alias: ["diagnostico", "salud", "sistema", "debug", "desarrollador", "estado"] },
];

/** Ítems visibles para un rol dado (y si es desarrollador, los ítems dev). */
export function navVisible(rol: Rol, esDev = false): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (i.dev) return esDev;
    return !i.roles || i.roles.includes(rol);
  });
}

/**
 * Navegación agrupada para el sidebar de escritorio: el Dashboard suelto arriba
 * y luego cada sección con sus ítems visibles. Solo devuelve grupos con ítems.
 */
export function navAgrupado(
  rol: Rol,
  esDev = false,
): { suelto: NavItem[]; grupos: { grupo: Grupo; items: NavItem[] }[] } {
  const visibles = navVisible(rol, esDev);
  const suelto = visibles.filter((i) => !i.grupo);
  const grupos = NAV_GRUPOS.map((grupo) => ({
    grupo,
    items: visibles.filter((i) => i.grupo === grupo),
  })).filter((g) => g.items.length > 0);
  return { suelto, grupos };
}

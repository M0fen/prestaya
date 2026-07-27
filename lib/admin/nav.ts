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
  | "Para tus clientes"
  | "Para tu equipo"
  | "Configuración";

export const NAV_GRUPOS: Grupo[] = [
  "Operación diaria",
  "Cartera y clientes",
  "Finanzas y análisis",
  "Para tus clientes",
  "Para tu equipo",
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
  // Solo el admin gobierna desde acá; el supervisor arranca en "Mi jornada" (y es
  // redirigido si entra por URL), así que no le mostramos este ítem en el menú.
  { href: "/admin", label: "Resumen del negocio", icon: "▣", roles: ["admin"], alias: ["dashboard", "inicio", "tablero", "resumen"] },
  // Flujo guiado del día (sobre todo para el supervisor): Apertura/En vivo/Cierre.
  { href: "/admin/jornada", label: "Mi jornada", icon: "🧭", roles: ["admin", "supervisor"], alias: ["jornada", "mi dia", "flujo", "guia del dia", "apertura", "en vivo", "cierre", "supervisor"] },
  // ── Operación diaria (el control del dinero, de un vistazo) ──
  { href: "/admin/cierre", label: "Cierre del día", icon: "🌅", grupo: "Operación diaria", roles: ["admin"], alias: ["cierre", "jornada", "operacion", "en vivo", "meta", "proyeccion", "hoy"] },
  { href: "/admin/cobranza", label: "Cobranza", icon: "🛡️", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["mapa", "geo", "cobros"] },
  { href: "/admin/recaudos", label: "Recaudos", icon: "💵", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["pagos", "cobros", "recaudo diario"] },
  { href: "/admin/caja", label: "Caja diaria", icon: "💰", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["arqueo", "rendiciones", "movimientos", "caja", "gastos"] },
  { href: "/admin/mora", label: "Mora", icon: "⏰", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["atrasos", "morosos", "riesgo", "recargo"] },
  { href: "/admin/campo", label: "Control de campo", icon: "🛰️", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["cobradores", "gps", "bitacora", "sospecha", "planchado", "malas mañas"] },
  { href: "/admin/anulaciones", label: "Anulaciones", icon: "🚫", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["anular", "anulacion", "doble registro", "reversar", "pago"] },
  { href: "/admin/gastos", label: "Gastos de ruta", icon: "⛽", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["aprobar gasto", "solicitud", "combustible", "sacar de caja", "egreso cobrador"] },
  // Centro de alertas: bandeja de vigilancia; va AL FINAL de la operación diaria
  // (se consulta cuando algo dispara, no es el arranque del día).
  { href: "/admin/alertas", label: "Centro de alertas", icon: "🚨", grupo: "Operación diaria", roles: ["admin", "supervisor"], alias: ["vigilancia", "fuga", "confianza cobrador", "sospecha", "faltante", "riesgo", "no pago"] },
  // ── Cartera y clientes ──
  { href: "/admin/clientes", label: "Clientes", icon: "👤", grupo: "Cartera y clientes", roles: ["admin", "supervisor"], alias: ["deudores", "cartera"] },
  { href: "/admin/informe-cartera", label: "Ventas Crédito", icon: "💳", grupo: "Cartera y clientes", roles: ["admin"], alias: ["creditos", "cartera", "interes", "utilidad", "deuda", "ventas a hoy", "con intereses", "recaudo", "informe"] },
  { href: "/admin/renovaciones", label: "Renovaciones", icon: "🔄", grupo: "Cartera y clientes", roles: ["admin", "supervisor"], alias: ["renovar", "recredito"] },
  { href: "/admin/altas", label: "Altas en la app", icon: "📱", grupo: "Cartera y clientes", roles: ["admin", "supervisor"], alias: ["qr", "codigo qr", "link cliente", "acceso cliente", "carton", "dar de alta", "onboarding", "entrega"] },
  { href: "/admin/scoring", label: "Scoring", icon: "🧮", grupo: "Cartera y clientes", roles: ["admin"], alias: ["riesgo", "modelo", "puntaje", "credit score", "pesos", "umbrales"] },
  // ── Finanzas y análisis ──
  { href: "/admin/estadisticas", label: "Estadísticas", icon: "📈", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["stats", "crecimiento", "cohortes", "tendencias", "colocacion", "distribucion", "comportamiento", "metricas"] },
  { href: "/admin/valor", label: "Valor", icon: "💎", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["roi", "rentabilidad"] },
  { href: "/admin/comisiones", label: "Comisiones", icon: "📊", grupo: "Finanzas y análisis", roles: ["admin", "supervisor"], alias: ["liquidacion", "cobradores", "vendedores"] },
  { href: "/admin/desempeno", label: "Desempeño", icon: "🏆", grupo: "Finanzas y análisis", roles: ["admin", "supervisor"], alias: ["historial", "rendimiento", "cobradores", "ranking", "rango", "desde hasta", "por fecha", "de fecha a fecha"] },
  { href: "/admin/capital", label: "Inversión de capital", icon: "🏦", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["capital", "aportes", "inversion"] },
  { href: "/admin/reportes", label: "Reportes", icon: "📨", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["exportar", "csv", "excel", "descargar", "estado de cuenta", "pdf", "respaldo", "backup"] },
  { href: "/admin/empalme", label: "Empalme y reconciliación", icon: "🔗", grupo: "Finanzas y análisis", roles: ["admin"], alias: ["reconciliacion", "diferencias", "trazabilidad", "kill switch", "solo lectura", "invariantes", "cuadre", "sobre-cobro", "conciliar"] },
  // ── Para tus clientes (lo que ve el DEUDOR en su pantalla) ──
  // Anuncios y Rifa son COMUNICACIÓN al cliente (banners que ve en su pantalla; el
  // supervisor también publica anuncios). Juego/Sorteos/Estrellas = config lúdica
  // GLOBAL (dinero-adyacente): solo el dueño (admin); el supervisor no los ve
  // (además su RLS no acota estrellas por zona).
  { href: "/admin/tienda", label: "Tienda", icon: "🛍️", grupo: "Para tus clientes", roles: ["admin"], alias: ["productos", "catalogo", "vender", "producto a credito", "solicitudes", "leads", "precio", "articulos"] },
  { href: "/admin/anuncios", label: "Anuncios al cliente", icon: "📣", grupo: "Para tus clientes", roles: ["admin", "supervisor"], alias: ["publicidad", "campanas", "banner", "banner cliente", "temporada", "aviso cliente", "novedad"] },
  { href: "/admin/rifa", label: "Rifa", icon: "🎁", grupo: "Para tus clientes", roles: ["admin"], alias: ["premio", "sorteo", "banner", "mejores clientes", "rifa cliente"] },
  { href: "/admin/promos", label: "Juegos y sorteos", icon: "🎟️", grupo: "Para tus clientes", roles: ["admin"], alias: ["raspadita", "quiniela", "sorteo", "promocion"] },
  { href: "/admin/juego", label: "Zona de juego", icon: "🎮", grupo: "Para tus clientes", roles: ["admin"], alias: ["gaming", "recompensas", "temporada", "caritas"] },
  { href: "/admin/estrellas", label: "Estrellas", icon: "⭐", grupo: "Para tus clientes", roles: ["admin"], alias: ["canjes", "redenciones", "premios"] },
  // ── Para tu equipo (lo que ven COBRADORES / SUPERVISORES) ──
  // Banner al equipo = aviso fijo arriba de la app del cobrador (antes escondido
  // dentro de Chat; ahora tiene entrada propia para que el admin lo encuentre).
  { href: "/admin/banner-equipo", label: "Banner al equipo", icon: "📢", grupo: "Para tu equipo", roles: ["admin", "supervisor"], alias: ["aviso equipo", "banner cobrador", "mensaje cobradores", "aviso cobrador", "comunicado", "cartel equipo"] },
  { href: "/admin/chat", label: "Chat", icon: "💬", grupo: "Para tu equipo", alias: ["mensajes", "equipo", "coordinacion"] },
  { href: "/admin/notas", label: "Notas", icon: "📝", grupo: "Para tu equipo", alias: ["apuntes", "recordatorio"] },
  // ── Configuración ──
  { href: "/admin/zonas", label: "Zonas", icon: "🗺️", grupo: "Configuración", roles: ["admin"], alias: ["territorio", "barrio", "ruta", "sector", "cobradores", "supervisor"] },
  { href: "/admin/equipo", label: "Equipo", icon: "🧑‍🤝‍🧑", grupo: "Configuración", roles: ["admin", "supervisor"], alias: ["permisos", "roles", "supervisora", "esposa", "usuarios", "contraseña", "acceso", "restablecer", "clave", "olvidó"] },
  { href: "/admin/recibos", label: "Recibos", icon: "🧾", grupo: "Configuración", roles: ["admin"], alias: ["factura", "comprobante", "pago", "sueldo", "adelanto", "trabajador"] },
  { href: "/admin/auditoria", label: "Auditoría", icon: "🧾", grupo: "Configuración", roles: ["admin", "supervisor"], alias: ["log", "registro", "acciones"] },
  { href: "/admin/tutorial", label: "Cómo se usa", icon: "🎓", grupo: "Configuración", alias: ["tutorial", "ayuda", "guia", "manual", "instrucciones", "aprender"] },
  { href: "/admin/seguridad", label: "Seguridad", icon: "🔐", grupo: "Configuración", alias: ["2fa", "dos pasos", "mfa", "totp", "contraseña", "verificacion"] },
  { href: "/admin/dev", label: "Dev", icon: "🛠️", grupo: "Configuración", dev: true, alias: ["diagnostico", "salud", "sistema", "debug", "desarrollador", "estado"] },
  { href: "/admin/uso", label: "Auditoría de uso", icon: "🕵️", grupo: "Configuración", dev: true, alias: ["comportamiento", "capacitacion", "telemetria", "personal", "clics", "actividad", "quien usa", "navegacion", "logins"] },
];

/** Orden de los dos ítems SUELTOS de arriba, por rol. El supervisor opera desde
 *  "Mi jornada" (su hub del día) → primero; el admin gobierna desde el "Resumen
 *  del negocio" (Dashboard) → primero. Lo comparten el sidebar, el command
 *  palette y la barra inferior mobile para que la jerarquía sea coherente. */
export function ordenSuelto(rol: Rol): string[] {
  return rol === "supervisor"
    ? ["/admin/jornada", "/admin"]
    : ["/admin", "/admin/jornada"];
}

/** Ítems visibles para un rol dado (y si es desarrollador, los ítems dev). Los
 *  dos ítems sueltos de arriba se ordenan según el rol (ver ordenSuelto); el
 *  resto del menú queda intacto. */
export function navVisible(rol: Rol, esDev = false): NavItem[] {
  const items = NAV_ITEMS.filter((i) => {
    if (i.dev) return esDev;
    return !i.roles || i.roles.includes(rol);
  });
  const orden = ordenSuelto(rol);
  const rank = (href: string) => {
    const k = orden.indexOf(href);
    return k === -1 ? orden.length : k;
  };
  const suelto = items
    .filter((i) => !i.grupo)
    .sort((a, b) => rank(a.href) - rank(b.href));
  const conGrupo = items.filter((i) => i.grupo);
  return [...suelto, ...conGrupo];
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

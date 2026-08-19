// ─────────────────────────────────────────────────────────────────────────
//  QUÉ HAY DE NUEVO — por versión y por rol (piloto 19-08).
//
//  El problema: deployamos features que el equipo había pedido y volvieron a
//  quejarse de lo mismo — porque nada en la app decía "ahora esto está acá".
//  Una feature que no se encuentra es una feature que no existe. Esta lista se
//  muestra UNA vez por versión en la home de cada rol (NovedadesCard, clave
//  localStorage `py_novedades_<version>`), con link directo a cada cosa.
//
//  Cómo se usa: al deployar algo que el equipo tiene que ENCONTRAR, subí la
//  VERSION (fecha) y agregá las líneas por rol. Sin código nuevo, sin tablas.
// ─────────────────────────────────────────────────────────────────────────
import type { Rol } from "@/types/db";

export interface Novedad {
  texto: string;
  href: string;
}

export const NOVEDADES_VERSION = "2026-08-19";

export const NOVEDADES: Partial<Record<Rol, Novedad[]>> = {
  supervisor: [
    { texto: "Los pedidos de la calle (renovar o vender por sobre el tope) los aprobás VOS: tab «Pedidos» abajo, con el contador. Te avisamos al celular si activás los avisos.", href: "/admin/renovaciones" },
    { texto: "Ventas y pagos de cualquier día, uno por uno, a quién y por quién: «Movimientos del día» (también desde el ← de Mi jornada).", href: "/admin/movimientos" },
    { texto: "Cancelar una venta mal hecha: botón «Cancelar…» en cada venta de Movimientos y en la ficha del cliente.", href: "/admin/movimientos" },
  ],
  admin: [
    { texto: "Pedidos de la calle en el tab «Pedidos» con contador; Movimientos del día con ventas y pagos uno por uno; cancelar ventas desde la lista.", href: "/admin/movimientos" },
    { texto: "El +20% ahora mide contra el crédito más grande del cliente (actual o pasado), y el gestor puede autorizar hasta +20% con piso en $100.000.", href: "/admin/renovaciones" },
  ],
  cobrador: [
    { texto: "Renovar → «Cambiar monto, cuotas o formato»: subí hasta +20% vos solo (sobre su crédito más grande); si te pasás, el pedido le llega a tu supervisor. Y elegí diario o semanal.", href: "/cobrador/colocar" },
    { texto: "Un pedido que demora: en «Mis pedidos» tocá «Recordarle a mi supervisor» (le llega por chat, celular y WhatsApp).", href: "/cobrador" },
    { texto: "Tus pagos y ventas de CUALQUIER día: Informes → «← Día anterior».", href: "/cobrador/informes" },
  ],
};

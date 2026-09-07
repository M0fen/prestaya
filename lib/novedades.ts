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

export const NOVEDADES_VERSION = "2026-09-06";

export const NOVEDADES: Partial<Record<Rol, Novedad[]>> = {
  supervisor: [
    { texto: "Ya no aprobás el +20%: el cobrador coloca directo cualquier monto y a vos te llega un AVISO (push si lo activaste, y el chat de la zona siempre). Los ves en «Pedidos y renovaciones» → «Colocados por encima del +20%».", href: "/admin/renovaciones" },
    { texto: "Ventas y pagos de cualquier día, uno por uno, a quién y por quién: «Movimientos del día» (también desde el ← de Mi jornada).", href: "/admin/movimientos" },
    { texto: "Cancelar una venta mal hecha: botón «Cancelar…» en cada venta de Movimientos y en la ficha del cliente.", href: "/admin/movimientos" },
  ],
  admin: [
    { texto: "Pedidos de la calle: en el celular, tab «Pedidos» con contador; en escritorio, «Pedidos y renovaciones» en el menú. Y una franja arriba que avisa sola cuando entra uno.", href: "/admin/renovaciones" },
    { texto: "Movimientos del día: ventas y pagos uno por uno, de hoy o de cualquier día; cancelar ventas desde la lista.", href: "/admin/movimientos" },
    { texto: "Regla nueva (06-09): el cobrador coloca CUALQUIER monto sin pedir permiso. Por encima del +20% del último crédito, el crédito nace igual y te llega un aviso (push + chat de zona) y queda listado en «Pedidos y renovaciones» → «Colocados por encima del +20%». Ya no hay cola de aprobación.", href: "/admin/renovaciones" },
  ],
  cobrador: [
    { texto: "Renovar → «Cambiar monto, cuotas o formato»: ahora podés subir CUALQUIER monto y se crea al toque. Por encima del +20% se crea igual y le avisamos a tu supervisor — vos entregale la plata. Y elegí diario o semanal.", href: "/cobrador/colocar" },
    { texto: "Tus pagos y ventas de CUALQUIER día: Informes → «← Día anterior».", href: "/cobrador/informes" },
  ],
};

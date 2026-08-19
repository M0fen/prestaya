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

export const NOVEDADES_VERSION = "2026-08-19b";

export const NOVEDADES: Partial<Record<Rol, Novedad[]>> = {
  supervisor: [
    { texto: "Los pedidos de la calle (renovar o vender por sobre el +20%) los aprobás VOS: tab «Pedidos» abajo con el contador, y una franja arriba que aparece sola cuando entra uno nuevo — sin activar nada.", href: "/admin/renovaciones" },
    { texto: "Ventas y pagos de cualquier día, uno por uno, a quién y por quién: «Movimientos del día» (también desde el ← de Mi jornada).", href: "/admin/movimientos" },
    { texto: "Cancelar una venta mal hecha: botón «Cancelar…» en cada venta de Movimientos y en la ficha del cliente.", href: "/admin/movimientos" },
  ],
  admin: [
    { texto: "Pedidos de la calle en el tab «Pedidos» con contador y franja de aviso; Movimientos del día con ventas y pagos uno por uno; cancelar ventas desde la lista.", href: "/admin/movimientos" },
    { texto: "El +20% se mide contra el ÚLTIMO crédito registrado del cliente; hasta ahí lo coloca el cobrador solo, más lo aprobás vos (o el supervisor) hasta +20% con piso en $100.000.", href: "/admin/renovaciones" },
  ],
  cobrador: [
    { texto: "Renovar → «Cambiar monto, cuotas o formato»: subí hasta +20% sobre su último crédito vos solo; si pedís más, queda en firme apenas lo apruebe tu supervisor (se lo mostramos al instante). Y elegí diario o semanal.", href: "/cobrador/colocar" },
    { texto: "Un pedido que demora: en «Tus pedidos», en tu inicio, tocá «Recordarle a mi supervisor» — le avisamos por el chat de la zona y al celular, y te dejamos el WhatsApp armado para mandárselo.", href: "/cobrador" },
    { texto: "Tus pagos y ventas de CUALQUIER día: Informes → «← Día anterior».", href: "/cobrador/informes" },
  ],
};

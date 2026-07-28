// Set de íconos SVG monocromo (estilo línea, 24×24). Heredan `currentColor`, así
// el estado activo/inactivo se controla con la clase de color del texto (algo que
// un emoji NO permite: la opacidad no afecta a un glifo multicolor). Reemplazan a
// los emojis en las barras de navegación, donde la señal de "dónde estoy" importa.
import type { SVGProps } from "react";

const PATHS: Record<string, React.ReactNode> = {
  // Inicio / dashboard (casa).
  inicio: (
    <>
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
    </>
  ),
  // Ruta del cobrador (mapa plegado).
  ruta: (
    <>
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  // Jornada del gestor (brújula).
  jornada: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
    </>
  ),
  // Cobranza / anti-fuga (escudo).
  cobranza: (
    <>
      <path d="M12 3 5 5.5V11c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V5.5L12 3z" />
    </>
  ),
  // Caja (billetera).
  caja: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h12v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" />
      <path d="M17 13.5h.01" />
    </>
  ),
  // Chat (globo de mensaje).
  chat: (
    <>
      <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 20l1.8-5.1A7.5 7.5 0 1 1 20 11.5z" />
    </>
  ),
  // Mis números (barras).
  numeros: (
    <>
      <path d="M6 20v-6M12 20V4M18 20v-9" />
    </>
  ),
  // Notas (documento con líneas).
  notas: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  // Ayuda / tutorial (interrogación).
  ayuda: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a3 3 0 0 1 5.6 1.3c0 2-2.8 2.5-2.8 4M12 17h.01" />
    </>
  ),
  // Menú (tres líneas).
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  // Apertura del día (amanecer).
  apertura: (
    <>
      <path d="M17 18a5 5 0 0 0-10 0" />
      <path d="M12 2v7M4.2 10.2l1.4 1.4M19.8 10.2l-1.4 1.4M1 18h2M21 18h2M23 22H1" />
      <path d="M8 6l4-4 4 4" />
    </>
  ),
  // En vivo (pulso/actividad).
  vivo: (
    <>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </>
  ),
  // Cierre del día (luna).
  cierre: (
    <>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </>
  ),
  // Mora (reloj).
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // Recaudos (billete).
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  // Desempeño (medalla).
  award: (
    <>
      <circle cx="12" cy="8.5" r="5.5" />
      <path d="M8.5 13.2 7 22l5-2.8 5 2.8-1.5-8.8" />
    </>
  ),
  // Alertas (campana).
  bell: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </>
  ),
  // Campo (pin de ubicación / GPS).
  pin: (
    <>
      <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.4" />
    </>
  ),
  // Renovar (flecha circular).
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v4.5h-4.5" />
    </>
  ),
  // Anular (prohibido).
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6 18.4 18.4" />
    </>
  ),
  // Clientes (persona).
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  // Gastos (surtidor de combustible).
  fuel: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3 21h11" />
      <path d="M13 9h3a1.5 1.5 0 0 1 1.5 1.5V16a1.8 1.8 0 0 0 3.5 0V9.5L18 6.5" />
    </>
  ),
  // ── "Para tus clientes" (lo que ve el cliente en su cartón) ──
  // Resumen / hub (diana).
  objetivo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  // Tienda (bolsa de compras).
  bolsa: (
    <>
      <path d="M5.5 8h13l-1 11.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9L5.5 8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  // Anuncios (megáfono).
  megafono: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h3l6 3.5V6.5L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M17 9.5a4 4 0 0 1 0 5" />
    </>
  ),
  // Rifa (regalo con moño).
  regalo: (
    <>
      <path d="M20 12v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V12" />
      <rect x="3" y="8" width="18" height="4" rx="0.5" />
      <path d="M12 8v12.5" />
      <path d="M12 8C10 8 8 7.2 8 5.7A1.6 1.6 0 0 1 12 5a1.6 1.6 0 0 1 4 .7C16 7.2 14 8 12 8z" />
    </>
  ),
  // Juegos y sorteos (ticket).
  ticket: (
    <>
      <path d="M3.5 8.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4v-2z" />
      <path d="M14.5 8v1.5M14.5 12v1.5M14.5 16v0.5" />
    </>
  ),
  // Estrellas (estrella de 5 puntas).
  estrella: (
    <>
      <path d="M12 3.6l2.6 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.2 2.7 1-5.7-4.1-4 5.7-.8L12 3.6z" />
    </>
  ),
};

/** Mapa href → ícono para la nav del panel (sidebar + launchpad). Cubre los ítems
 *  del día; los demás caen al emoji del ítem (fallback en SidebarNav). */
export const ICONO_NAV: Record<string, NombreIcono> = {
  "/admin": "inicio",
  "/admin/jornada": "jornada",
  "/admin/alertas": "bell",
  "/admin/cierre": "apertura",
  "/admin/cobranza": "cobranza",
  "/admin/recaudos": "cash",
  "/admin/caja": "caja",
  "/admin/mora": "clock",
  "/admin/campo": "pin",
  "/admin/anulaciones": "ban",
  "/admin/gastos": "fuel",
  "/admin/clientes": "user",
  "/admin/renovaciones": "refresh",
  "/admin/desempeno": "award",
  "/admin/chat": "chat",
  "/admin/notas": "notas",
  // Para tus clientes.
  "/admin/para-clientes": "objetivo",
  "/admin/tienda": "bolsa",
  "/admin/anuncios": "megafono",
  "/admin/rifa": "regalo",
  "/admin/promos": "ticket",
  "/admin/estrellas": "estrella",
};

export type NombreIcono = keyof typeof PATHS;

export function Icono({
  name,
  className,
  ...rest
}: { name: NombreIcono } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

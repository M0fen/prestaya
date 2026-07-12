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

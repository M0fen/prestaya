"use client";
// Botón FIJO para instalar la app, siempre a mano (no se descarta). Se usa donde
// pase la gente: la pantalla de ingreso (todo el equipo) y el cartón del cliente.
//   · Android/desktop → dispara el diálogo nativo.
//   · iPhone/iPad      → abre una hoja con el paso a paso (Compartir → Agregar).
// Si ya está instalada, o el navegador no lo permite todavía, no muestra nada
// (evita un botón que no hace nada).
import { useState } from "react";
import { useInstalacion, lanzarInstalacion } from "@/lib/pwa/instalar";

type Tono = "sobreOscuro" | "sobreClaro";

const ESTILO: Record<Tono, string> = {
  // Login (fondo azul oscuro): pastilla translúcida clara.
  sobreOscuro:
    "border border-white/25 bg-white/10 text-white hover:bg-white/15",
  // Superficies claras (cartón del cliente): pastilla azul suave.
  sobreClaro:
    "border border-[#C6D6FB] bg-[#EEF3FF] text-[#1E47C8] hover:bg-[#E4ECFF]",
};

export function BotonInstalar({
  tono = "sobreClaro",
  className = "",
}: {
  tono?: Tono;
  className?: string;
}) {
  const estado = useInstalacion();
  const [ayudaIOS, setAyudaIOS] = useState(false);

  // Nada que ofrecer: ya instalada, o el navegador aún no la marca instalable.
  if (estado === "instalada" || estado === "no-disponible") return null;

  const onClick = async () => {
    if (estado === "ios") {
      setAyudaIOS(true);
      return;
    }
    await lanzarInstalacion();
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors ${ESTILO[tono]} ${className}`}
      >
        <IconoTelefono />
        Instalar la app en tu teléfono
      </button>

      {ayudaIOS && <HojaAyudaIOS onCerrar={() => setAyudaIOS(false)} />}
    </>
  );
}

/** Instrucciones para iPhone (Safari no tiene diálogo automático). */
function HojaAyudaIOS({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Cómo instalar en iPhone"
    >
      <div
        className="w-full max-w-[380px] rounded-[22px] bg-white p-5 shadow-[0_24px_60px_rgba(9,20,60,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-[22px] font-black text-white">
            P
          </div>
          <h3 className="text-[16px] font-extrabold text-[#0F1B3D]">Instalar en tu iPhone</h3>
        </div>
        <ol className="flex flex-col gap-3">
          <PasoIOS n={1}>
            <span className="flex flex-wrap items-center gap-x-1">
              Tocá el botón
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="inline-block h-[16px] w-[16px] align-[-3px] text-[#2453DC]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15V3m0 0L8 7m4-4l4 4" />
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
              </svg>
              <b>Compartir</b>, abajo en la barra de Safari.
            </span>
          </PasoIOS>
          <PasoIOS n={2}>
            En el menú, elegí <b>Agregar a inicio</b> (o &ldquo;Add to Home Screen&rdquo;).
          </PasoIOS>
          <PasoIOS n={3}>
            Confirmá con <b>Agregar</b>. ¡Listo! El ícono queda en tu pantalla.
          </PasoIOS>
        </ol>
        <button
          type="button"
          onClick={onCerrar}
          className="mt-5 w-full rounded-full bg-[linear-gradient(135deg,#2453DC,#1E47C8)] px-4 py-3 text-[14px] font-extrabold text-white"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

function PasoIOS({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EEF3FF] text-[12px] font-black text-[#1E47C8]">
        {n}
      </span>
      <span className="text-[13.5px] leading-[1.5] font-medium text-[#3A4468]">{children}</span>
    </li>
  );
}

function IconoTelefono() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

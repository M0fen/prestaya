"use client";
// Banner discreto para INSTALAR la app en el teléfono. Aparece solo (primer uso)
// en cualquier pantalla. Dos caminos según el equipo:
//   · Android/Chrome/desktop → botón "Instalar" que dispara el diálogo nativo.
//   · iPhone/iPad (Safari)   → instrucción "Compartir → Agregar a inicio".
// Se oculta si ya está instalada. Al cerrarlo, se pospone (no para siempre):
// vuelve a las 2 semanas. Para instalar cuando quieras, además está el botón fijo.
import { useEffect, useState } from "react";
import { useInstalacion, lanzarInstalacion } from "@/lib/pwa/instalar";

const CLAVE_POSPUESTO = "py_pwa_pospuesto_hasta";
const DIAS_POSPONER = 14;

export function InstalarApp() {
  const estado = useInstalacion();
  const [pospuesto, setPospuesto] = useState(true); // asumimos oculto hasta leer localStorage

  useEffect(() => {
    try {
      const hasta = Number(localStorage.getItem(CLAVE_POSPUESTO) || 0);
      setPospuesto(Date.now() < hasta);
    } catch {
      setPospuesto(false);
    }
  }, []);

  const posponer = () => {
    setPospuesto(true);
    try {
      localStorage.setItem(CLAVE_POSPUESTO, String(Date.now() + DIAS_POSPONER * 86_400_000));
    } catch {
      /* sin localStorage: se oculta en esta sesión igual */
    }
  };

  const instalar = async () => {
    const r = await lanzarInstalacion();
    if (r === "accepted") posponer(); // ya está: no volver a ofrecer pronto
  };

  // Solo cuando hay algo real que ofrecer y no fue pospuesto.
  if (pospuesto) return null;
  if (estado !== "listo" && estado !== "ios") return null;
  const esIOS = estado === "ios";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(76px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-[18px] border border-[#DCE3F4] bg-white p-3 shadow-[0_16px_34px_rgba(19,48,140,0.18)]">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-[22px] font-black text-white">
          P
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-[#0F1B3D]">Instalá Presta Ya</p>
          {esIOS ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] leading-[1.4] font-medium text-[#6B7494]">
              Tocá
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="inline-block h-[15px] w-[15px] align-[-2px] text-[#2453DC]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15V3m0 0L8 7m4-4l4 4" />
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
              </svg>
              <b>Compartir</b> y luego <b>Agregar a inicio</b>.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-[1.4] font-medium text-[#6B7494]">
              Guardala en tu teléfono y abrila con un toque.
            </p>
          )}
        </div>
        {!esIOS && (
          <button
            onClick={instalar}
            className="flex-shrink-0 rounded-full bg-[linear-gradient(90deg,#2453DC,#1E47C8)] px-4 py-2 text-[13px] font-bold text-white active:translate-y-px"
          >
            Instalar
          </button>
        )}
        <button
          onClick={posponer}
          aria-label="Ahora no"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[18px] text-[#9AA3BC] hover:bg-[#F4F6FB]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

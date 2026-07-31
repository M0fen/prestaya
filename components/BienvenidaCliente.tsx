"use client";
// Bienvenida del CLIENTE — la primera vez que abre su cartón (localStorage).
// Pensada para adultos mayores: texto grande, tono tranquilo, y el mensaje
// clave que baja la ansiedad → "es solo para MIRAR, no tenés que hacer nada".
// Se cierra con un toque y no vuelve a molestar. Paleta del sitio (sin alarma).
import { useEffect, useState } from "react";

export function BienvenidaCliente() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let yaVista = true;
    try {
      yaVista = Boolean(window.localStorage.getItem("py_bienvenida_cliente"));
    } catch {
      /* sin storage: no molestamos → la tratamos como ya vista */
    }
    setVisible(!yaVista);
  }, []);

  const cerrar = () => {
    try {
      window.localStorage.setItem("py_bienvenida_cliente", "1");
    } catch {
      /* sin storage */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section className="relative rounded-[18px] border border-[#DCE6FB] bg-[#F3F7FF] p-4">
      <button
        type="button"
        onClick={cerrar}
        aria-label="Entendido, cerrar"
        className="absolute right-2.5 top-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[14px] font-bold text-gris shadow-[0_1px_3px_rgba(15,27,61,0.12)] active:scale-95"
      >
        ✕
      </button>
      <div className="flex flex-col gap-2 pr-6">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-[20px]">👋</span>
          <h2 className="text-[16px] font-extrabold text-tinta">Bienvenido a tu cartón</h2>
        </div>
        <p className="text-[14px] leading-[1.55] font-medium text-[#3A4468]">
          Acá podés ver <b>cuánto pagaste</b>, <b>cuánto te falta</b> y el <b>comprobante</b> de cada
          cuota, cuando quieras.
        </p>
        <p className="text-[14px] leading-[1.5] font-semibold text-[#157A50]">
          Es solo para mirar: no tenés que hacer nada. 😊
        </p>
        <button
          type="button"
          onClick={cerrar}
          className="mt-1 w-fit rounded-full bg-[#1E47C8] px-5 py-2.5 text-[14px] font-extrabold text-white active:scale-95"
        >
          Entendido
        </button>
      </div>
    </section>
  );
}

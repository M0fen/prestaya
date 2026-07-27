"use client";
// Control de accesibilidad flotante: tamaño de texto (A+) y alto contraste.
// Pensado para adultos mayores. Aplica las preferencias en <html> (data-attrs)
// y las recuerda en localStorage. No depende del resto de la app.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function AccesibilidadControl() {
  const pathname = usePathname();
  const [font, setFont] = useState(0); // 0 = normal, 1 = grande, 2 = más grande
  const [contraste, setContraste] = useState(false);

  // Cargar preferencias guardadas al montar.
  useEffect(() => {
    const f = Number(localStorage.getItem("py_font") || "0");
    setFont(Number.isFinite(f) ? Math.min(2, Math.max(0, f)) : 0);
    setContraste(localStorage.getItem("py_contraste") === "1");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.font = String(font);
    try {
      localStorage.setItem("py_font", String(font));
    } catch {
      /* noop */
    }
  }, [font]);

  useEffect(() => {
    if (contraste) document.documentElement.dataset.contraste = "1";
    else delete document.documentElement.dataset.contraste;
    try {
      localStorage.setItem("py_contraste", contraste ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [contraste]);

  // El panel del admin (escritorio) y el login no usan este control.
  // El COBRADOR sí (adultos, letra chica en la calle): se muestra levantado por
  // encima de su barra inferior para no taparla.
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/ingresar")) return null;
  const esCobrador = pathname?.startsWith("/cobrador");

  return (
    <div
      className={`fixed right-3 z-50 flex items-center gap-1.5 ${esCobrador ? "bottom-24" : "bottom-3"}`}
    >
      <button
        type="button"
        onClick={() => setFont((f) => (f + 1) % 3)}
        aria-label="Cambiar tamaño del texto"
        title="Tamaño del texto"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-[#DCE3F4] bg-white text-[15px] font-extrabold text-azul shadow-[0_4px_14px_rgba(15,27,61,0.18)] active:scale-95"
      >
        A{font === 0 ? "+" : font === 1 ? "++" : ""}
        {font === 2 ? "−" : ""}
      </button>
      <button
        type="button"
        onClick={() => setContraste((c) => !c)}
        aria-label="Alto contraste"
        aria-pressed={contraste}
        title="Alto contraste"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-[#DCE3F4] bg-white text-[18px] shadow-[0_4px_14px_rgba(15,27,61,0.18)] active:scale-95"
        style={{ color: contraste ? "#0F1B3D" : "#6B7494" }}
      >
        ◐
      </button>
    </div>
  );
}

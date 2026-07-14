"use client";
// Tarjeta de bienvenida cálida por rol. Aparece la PRIMERA vez que la persona
// entra a su "casa" (localStorage) y se puede cerrar: da la bienvenida por nombre,
// dice en una frase "esto es lo tuyo" y ofrece un "empezá por acá". No molesta de
// nuevo una vez cerrada. Que se sientan en casa desde el primer minuto.
import { useEffect, useState } from "react";
import Link from "next/link";

export function BienvenidaCard({
  id,
  saludo,
  titulo,
  cuerpo,
  cta,
}: {
  /** Clave única por rol (p. ej. "admin", "cobrador"): recuerda si ya la cerró. */
  id: string;
  /** Línea de saludo personal, p. ej. "Buen día, Mauricio 👋". */
  saludo: string;
  titulo: string;
  cuerpo: string;
  cta?: { href: string; texto: string };
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(`py_bienvenida_${id}`)) setVisible(true);
    } catch {
      /* sin storage: no molestamos */
    }
  }, [id]);

  const cerrar = () => {
    try {
      window.localStorage.setItem(`py_bienvenida_${id}`, "1");
    } catch {
      /* sin storage */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#2453DC_0%,#1E47C8_45%,#13308C_100%)] p-5 text-white shadow-[0_14px_34px_rgba(19,48,140,0.30)]">
      {/* Adorno suave */}
      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar bienvenida"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[13px] font-bold text-white/90 transition-colors hover:bg-white/25"
      >
        ✕
      </button>
      <div className="relative flex flex-col gap-1.5">
        <span className="text-[13px] font-extrabold text-white">{saludo}</span>
        <h2 className="text-[19px] leading-tight font-extrabold tracking-[-0.01em]">{titulo}</h2>
        <p className="max-w-[46ch] text-[13px] leading-[1.55] font-medium text-white/85">{cuerpo}</p>
        {cta && (
          <Link
            href={cta.href}
            onClick={cerrar}
            className="mt-1.5 w-fit rounded-full bg-white px-4 py-2 text-[13px] font-extrabold text-[#13308C] shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition-transform active:scale-95"
          >
            {cta.texto} →
          </Link>
        )}
      </div>
    </section>
  );
}

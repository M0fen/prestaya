"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Carrusel de anuncios (banner). El admin/supervisor carga varios eventos y
//  avisos; acá rotan solos deslizándose hacia la derecha, con puntos para
//  navegar y arrastre táctil. Efecto "brillo" sutil. Respeta reduced-motion.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import type { Anuncio, TemaAnuncio } from "@/types/db";
import { hrefSeguro } from "@/lib/seguridad";

const TEMA_BG: Record<TemaAnuncio, string> = {
  azul: "linear-gradient(135deg,#2453DC,#13308C)",
  verde: "linear-gradient(135deg,#1FA971,#157A50)",
  ambar: "linear-gradient(135deg,#F0B638,#C9870D)",
  oscuro: "linear-gradient(135deg,#1E2A50,#0F1B3D)",
  // Publicidad premium (negro + oro), pensado para anunciantes tipo curbe.
  dorado: "linear-gradient(145deg,#241d10 0%,#14110a 55%,#0a0805 100%)",
};

// Acentos por tema: color del "eyebrow", del botón y del brillo. El dorado usa
// oro para que el aviso auspiciado se sienta premium sin dejar de ser legible.
const ORO = "#E6C67A";
const ACENTO: Record<TemaAnuncio, { eyebrow: string; ctaBg: string; ctaFg: string; glow: string }> = {
  azul: { eyebrow: "rgba(255,255,255,0.72)", ctaBg: "#FFFFFF", ctaFg: "#0F1B3D", glow: "rgba(255,255,255,0.08)" },
  verde: { eyebrow: "rgba(255,255,255,0.72)", ctaBg: "#FFFFFF", ctaFg: "#0F1B3D", glow: "rgba(255,255,255,0.08)" },
  ambar: { eyebrow: "rgba(255,255,255,0.75)", ctaBg: "#FFFFFF", ctaFg: "#0F1B3D", glow: "rgba(255,255,255,0.10)" },
  oscuro: { eyebrow: "rgba(255,255,255,0.66)", ctaBg: "#FFFFFF", ctaFg: "#0F1B3D", glow: "rgba(255,255,255,0.07)" },
  dorado: { eyebrow: ORO, ctaBg: ORO, ctaFg: "#1A1206", glow: "rgba(230,198,122,0.12)" },
};

const INTERVALO = 5000;

export function BannerCarrusel({ anuncios }: { anuncios: Anuncio[] }) {
  const [i, setI] = useState(0);
  const dragX = useRef<number | null>(null);
  const n = anuncios.length;

  // Auto-avance (pausado si el usuario prefiere menos movimiento o hay 1 solo).
  useEffect(() => {
    if (n <= 1) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => setI((v) => (v + 1) % n), INTERVALO);
    return () => clearInterval(id);
  }, [n]);

  if (n === 0) return null;

  function onDown(e: React.PointerEvent) {
    dragX.current = e.clientX;
  }
  function onUp(e: React.PointerEvent) {
    if (dragX.current == null) return;
    const dx = e.clientX - dragX.current;
    if (dx < -40) setI((v) => (v + 1) % n);
    else if (dx > 40) setI((v) => (v - 1 + n) % n);
    dragX.current = null;
  }

  return (
    <section aria-label="Novedades" className="flex flex-col gap-2">
      <div
        className="relative overflow-hidden rounded-[22px] shadow-[0_12px_28px_rgba(19,48,140,0.22)]"
        onPointerDown={onDown}
        onPointerUp={onUp}
      >
        {/* Pista deslizante */}
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${i * 100}%)` }}
        >
          {anuncios.map((a) => (
            <Slide key={a.id} anuncio={a} />
          ))}
        </div>
      </div>

      {/* Puntos de navegación */}
      {n > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {anuncios.map((a, idx) => (
            <button
              key={a.id}
              type="button"
              aria-label={`Ver anuncio ${idx + 1}`}
              onClick={() => setI(idx)}
              className="flex h-11 items-center justify-center -my-3 px-1"
            >
              <span
                className="h-2 rounded-full transition-all"
                style={{
                  width: idx === i ? 18 : 8,
                  background: idx === i ? "#1E47C8" : "#C7D2EC",
                }}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Slide({ anuncio }: { anuncio: Anuncio }) {
  // Defensa en profundidad: nunca llevamos un cta_url no confiable a un href.
  const hrefCta = hrefSeguro(anuncio.cta_url);
  const tieneCta = Boolean(anuncio.cta_texto && hrefCta);
  const acento = ACENTO[anuncio.tema] ?? ACENTO.azul;
  // Eyebrow configurable: por defecto "Novedad"; publicidad externa usa "Publicidad".
  const eyebrow = anuncio.etiqueta?.trim() || "Novedad";
  return (
    <div className="w-full flex-shrink-0 px-[7px]" style={{ minWidth: "100%" }}>
      <div
        className="py-shine relative overflow-hidden rounded-[18px] p-[18px] text-white"
        style={{ background: TEMA_BG[anuncio.tema] }}
      >
        <div
          className="pointer-events-none absolute -top-[50px] -right-[40px] h-[150px] w-[150px] rounded-full"
          style={{ background: acento.glow }}
        />
        <div className="relative flex items-center gap-4">
          {anuncio.imagen_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={anuncio.imagen_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-[58px] w-[58px] flex-shrink-0 rounded-[14px] object-cover"
            />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className="text-[10.5px] font-extrabold tracking-[0.14em] uppercase"
              style={{ color: acento.eyebrow }}
            >
              {eyebrow}
            </span>
            <h3 className="m-0 text-[16.5px] leading-[1.2] font-extrabold tracking-[-0.01em]">
              {anuncio.titulo}
            </h3>
            {anuncio.cuerpo && (
              <p className="m-0 text-[12.5px] leading-[1.45] font-medium text-white/[0.8]">
                {anuncio.cuerpo}
              </p>
            )}
            {tieneCta && (
              <a
                href={hrefCta!}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-opacity hover:opacity-90"
                style={{ background: acento.ctaBg, color: acento.ctaFg }}
              >
                {anuncio.cta_texto}
                <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

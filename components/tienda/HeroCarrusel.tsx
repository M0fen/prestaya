"use client";
// ─────────────────────────────────────────────────────────────────────────
//  HERO de la Tienda Presta Ya — CARRUSEL de banners. La tienda es un catálogo
//  GENERAL (electrodomésticos, tecnología, y también las fragancias/joyas de
//  Curbe), así que el hero rota entre mensajes: uno general de Presta Ya y uno
//  de Curbe (que doblega como pieza publicitaria, con su imagen y link a curbe.uy).
//  Cada slide trae SU propia imagen → nunca un titular de perfumes con foto de heladera.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useCallback } from "react";

export type HeroSlide = {
  tema: "prestaya" | "curbe";
  eyebrow: string;
  titulo: string;
  /** Parte del título a resaltar con el color de acento (opcional). */
  acento?: string;
  sub: string;
  img: string | null;
  imgLabel?: string | null;
  cta?: { label: string; href: string } | null;
};

const TEMA: Record<HeroSlide["tema"], { bg: string; glow: string; accent: string }> = {
  prestaya: {
    bg: "linear-gradient(130deg,#2453DC 0%,#1E47C8 45%,#13308C 100%)",
    glow: "radial-gradient(90%_90%_at_90%_-10%,rgba(255,255,255,0.18),transparent_55%)",
    accent: "#8FE7C0",
  },
  curbe: {
    bg: "linear-gradient(135deg,#141E3C 0%,#0E1834 100%)",
    glow: "radial-gradient(120%_120%_at_88%_-15%,rgba(232,197,110,0.22),transparent_55%)",
    accent: "#E8C56E",
  },
};

function Titulo({ titulo, acento, color }: { titulo: string; acento?: string; color: string }) {
  if (!acento || !titulo.includes(acento)) return <>{titulo}</>;
  const [pre, ...rest] = titulo.split(acento);
  const post = rest.join(acento);
  return (
    <>
      {pre}
      {/* Palabra de acento con SHIMMER sutil (toque premium, como e-commerce top). */}
      <span
        className="hero-acento"
        style={{ backgroundImage: `linear-gradient(100deg, ${color} 35%, #ffffff 50%, ${color} 65%)` }}
      >
        {acento}
      </span>
      {post}
    </>
  );
}

export function HeroCarrusel({ slides }: { slides: HeroSlide[] }) {
  const n = slides.length;
  const [i, setI] = useState(0);
  const ir = useCallback((k: number) => setI(((k % n) + n) % n), [n]);
  // Sin auto-avance: mover el contenido antes de que el usuario (incl. adultos
  // mayores) termine de leer/tocar es contraproducente. Navegación 100% manual.

  return (
    <section
      className="relative overflow-hidden rounded-[24px] shadow-[0_18px_44px_rgba(9,16,40,0.32)]"
      aria-roledescription="carrusel"
    >
      <style>{`
        .hero-acento{background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:heroShimmer 3.8s linear infinite}
        @keyframes heroShimmer{to{background-position:-200% center}}
        .hero-in{animation:heroIn .5s cubic-bezier(.2,.7,.2,1) both}
        @keyframes heroIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.hero-acento{animation:none}.hero-in{animation:none}}
      `}</style>
      {/* Pila de slides (crossfade). El activo manda el alto. */}
      <div className="relative">
        {slides.map((s, idx) => {
          const t = TEMA[s.tema];
          const activo = idx === i;
          return (
            <div
              key={idx}
              aria-hidden={!activo}
              className={`${activo ? "relative opacity-100" : "pointer-events-none absolute inset-0 opacity-0"} transition-opacity duration-700`}
              style={{ background: t.bg }}
            >
              <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: t.glow.replace(/_/g, " ") }} />
              <div key={activo ? "on" : "off"} className={`relative flex flex-col gap-5 p-6 text-white md:flex-row md:items-center md:justify-between md:p-10 ${activo ? "hero-in" : ""}`}>
                <div className="flex max-w-[500px] flex-col gap-3">
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: t.accent }}>{s.eyebrow}</span>
                  <h1 className="text-[27px] font-black leading-[1.06] tracking-[-0.02em] md:text-[40px]">
                    <Titulo titulo={s.titulo} acento={s.acento} color={t.accent} />
                  </h1>
                  <p className="max-w-[460px] text-[13.5px] font-medium text-white/72 md:text-[15px]">{s.sub}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-white/80">
                    <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5">🚚 Entrega a domicilio</span>
                    <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5">💳 Cuotas cómodas</span>
                    <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5">🛡️ Garantía</span>
                  </div>
                  {s.cta && (
                    <a
                      href={s.cta.href}
                      target={s.cta.href.startsWith("http") ? "_blank" : undefined}
                      rel={s.cta.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="mt-1 w-fit rounded-full px-4 py-2 text-[12.5px] font-extrabold text-[#13308C]"
                      style={{ background: t.accent }}
                    >
                      {s.cta.label}
                    </a>
                  )}
                </div>
                {s.img && (
                  <div className="relative mx-auto w-full max-w-[260px] md:mx-0 md:w-[280px] md:flex-shrink-0">
                    <div className="absolute -inset-3 rounded-[26px] blur-xl" style={{ background: `radial-gradient(circle, ${t.accent}44, transparent 70%)` }} aria-hidden />
                    <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.05] p-3 backdrop-blur">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.img} alt={s.imgLabel ?? ""} className="mx-auto aspect-square w-full rounded-[14px] bg-white object-contain p-2" />
                      {s.imgLabel && (
                        <span className="mt-2 block truncate px-1 text-[12px] font-bold text-white">{s.imgLabel}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Controles */}
      {n > 1 && (
        <>
          <button type="button" onClick={() => ir(i - 1)} aria-label="Anterior"
            className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40 md:flex">‹</button>
          <button type="button" onClick={() => ir(i + 1)} aria-label="Siguiente"
            className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40 md:flex">›</button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
            {slides.map((_, idx) => (
              <button key={idx} type="button" onClick={() => ir(idx)} aria-label={`Ir al banner ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${idx === i ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

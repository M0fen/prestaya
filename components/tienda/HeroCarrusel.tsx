"use client";
// ─────────────────────────────────────────────────────────────────────────
//  HERO de la Tienda Presta Ya — CARRUSEL de banners (Embla).
//  La tienda es un catálogo GENERAL (electrodomésticos, tecnología, y también
//  las fragancias/joyas de Curbe), así que el hero rota entre mensajes: uno
//  general de Presta Ya y uno de Curbe (que dobla como pieza publicitaria, con
//  su imagen y link a curbe.uy). Cada slide trae SU propia imagen.
//  Embla da swipe táctil con momentum (sensación e-commerce) + dots/flechas
//  sincronizados. SIN auto-avance: mover el contenido antes de que el usuario
//  (incl. adultos mayores) termine de leer/tocar es contraproducente.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";

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
    glow: "radial-gradient(90% 90% at 90% -10%,rgba(255,255,255,0.18),transparent 55%)",
    accent: "#8FE7C0",
  },
  curbe: {
    bg: "linear-gradient(135deg,#141E3C 0%,#0E1834 100%)",
    glow: "radial-gradient(120% 120% at 88% -15%,rgba(232,197,110,0.22),transparent 55%)",
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

function Slide({ s }: { s: HeroSlide }) {
  const t = TEMA[s.tema];
  return (
    <div className="relative min-w-0 flex-[0_0_100%]" style={{ background: t.bg }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: t.glow }} />
      <div className="relative flex flex-col gap-5 p-6 text-white md:flex-row md:items-center md:justify-between md:p-10">
        <div className="flex max-w-[500px] flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: t.accent }}>{s.eyebrow}</span>
          <h2 className="text-[27px] font-black leading-[1.06] tracking-[-0.02em] md:text-[40px]">
            <Titulo titulo={s.titulo} acento={s.acento} color={t.accent} />
          </h2>
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
              className="mt-1 w-fit rounded-full px-4 py-2.5 text-[12.5px] font-extrabold text-[#13308C] transition active:scale-95"
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
              <img src={s.img} alt={s.imgLabel ?? ""} draggable={false} className="mx-auto aspect-square w-full select-none rounded-[14px] bg-white object-contain p-2" />
              {s.imgLabel && (
                <span className="mt-2 block truncate px-1 text-[12px] font-bold text-white">{s.imgLabel}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function HeroCarrusel({ slides }: { slides: HeroSlide[] }) {
  const n = slides.length;
  const [emblaRef, embla] = useEmblaCarousel({ loop: n > 1, align: "center", skipSnaps: false });
  const [sel, setSel] = useState(0);

  const ir = useCallback((k: number) => embla?.scrollTo(k), [embla]);

  useEffect(() => {
    if (!embla) return;
    const onSel = () => setSel(embla.selectedScrollSnap());
    embla.on("select", onSel);
    onSel();
    return () => { embla.off("select", onSel); };
  }, [embla]);

  return (
    <section
      className="relative overflow-hidden rounded-[24px] shadow-[0_18px_44px_rgba(9,16,40,0.32)]"
      aria-roledescription="carrusel"
    >
      <style>{`
        .hero-acento{background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:heroShimmer 3.8s linear infinite}
        @keyframes heroShimmer{to{background-position:-200% center}}
        @media (prefers-reduced-motion: reduce){.hero-acento{animation:none}}
      `}</style>

      {/* Viewport Embla: swipe con momentum. El contenedor flex es el "carril". */}
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {slides.map((s, idx) => <Slide key={idx} s={s} />)}
        </div>
      </div>

      {/* Controles */}
      {n > 1 && (
        <>
          <button type="button" onClick={() => ir(sel - 1)} aria-label="Anterior"
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40 md:flex">‹</button>
          <button type="button" onClick={() => ir(sel + 1)} aria-label="Siguiente"
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40 md:flex">›</button>
          <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-end gap-1">
            {slides.map((_, idx) => (
              // Hit area de ~44px (pt+pb) aunque la barrita visible mida 6px:
              // en touch no hay hover, los puntos son el único control en mobile.
              <button key={idx} type="button" onClick={() => ir(idx)} aria-label={`Ir al banner ${idx + 1}`}
                className="flex items-center px-1.5 pb-3 pt-9">
                <span className={`h-1.5 rounded-full transition-all ${idx === sel ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

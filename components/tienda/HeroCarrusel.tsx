"use client";
// ─────────────────────────────────────────────────────────────────────────
//  HERO de la Tienda Presta Ya — CARRUSEL de banners (Embla).
//  La tienda es un catálogo GENERAL (electrodomésticos, tecnología, y también
//  las fragancias/joyas de Curbe), así que el hero rota entre mensajes: uno
//  general de Presta Ya y uno de Curbe (que dobla como pieza publicitaria, con
//  su imagen y link a curbe.uy). Cada slide trae SU propia imagen.
//  Embla da swipe táctil con momentum (sensación e-commerce) + dots/flechas
//  sincronizados. Auto-avance LENTO (9s) para dar tiempo a leer (incl. adultos
//  mayores); se detiene apenas el usuario toca/pasa el mouse y respeta reduced-motion.
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
  /** Pills de valor GRANDES (como "Hasta 50% OFF" / "12 cuotas" de Mercado Libre). */
  pills?: string[];
  /** Etiqueta de precio FLOTANTE sobre el producto (como los "$X" de ML). */
  tag?: { linea1: string; linea2?: string };
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
          {s.pills && s.pills.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {s.pills.map((pill, k) => (
                <span key={k} className="rounded-full bg-white px-4 py-2 text-[13px] font-black text-[#13308C] shadow-[0_4px_14px_rgba(0,0,0,0.18)]" style={k === 1 ? { color: t.accent === "#E8C56E" ? "#8A6A16" : "#0F7A48" } : undefined}>{pill}</span>
              ))}
            </div>
          )}
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
          <div className="relative mx-auto w-full max-w-[270px] shrink-0 md:mx-0 md:w-[320px]">
            {/* Halo detrás del producto (glow del color de acento). */}
            <div className="absolute -inset-5 rounded-[36px] blur-2xl" style={{ background: `radial-gradient(circle at 50% 45%, ${t.accent}55, transparent 68%)` }} aria-hidden />
            {/* Panel blanco del producto (nuestras fotos vienen sobre blanco). */}
            <div className="relative overflow-hidden rounded-[22px] bg-white p-3 shadow-[0_26px_54px_rgba(0,0,0,0.32)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.img} alt={s.imgLabel ?? ""} draggable={false} className="mx-auto aspect-square w-full select-none object-contain p-1" />
              {s.imgLabel && (
                <span className="mt-1.5 block truncate px-1 text-[12.5px] font-bold text-tinta">{s.imgLabel}</span>
              )}
            </div>
            {/* Etiqueta de precio FLOTANTE, superpuesta (estilo Mercado Libre). */}
            {s.tag && (
              <div className="absolute -right-2 -top-3 z-20 rounded-[14px] px-3 py-1.5 text-right shadow-[0_10px_24px_rgba(0,0,0,0.35)]" style={{ background: t.accent }}>
                {s.tag.linea2 && <span className="block text-[9px] font-black uppercase leading-tight tracking-wide text-[#0F1B3D]/60">{s.tag.linea2}</span>}
                <span className="block text-[16px] font-black leading-tight tabular-nums text-[#0F1B3D]">{s.tag.linea1}</span>
              </div>
            )}
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

  // Auto-rotación LENTA (9s: tiempo de lectura para adultos mayores). Se detiene al
  // primer gesto (touch/drag) o al pasar el mouse por encima — no le movemos el
  // contenido en la mano. Respeta prefers-reduced-motion y no avanza con la pestaña oculta.
  useEffect(() => {
    if (!embla || n <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => { if (!document.hidden) embla.scrollNext(); }, 9000);
    const parar = () => clearInterval(id);
    embla.on("pointerDown", parar);
    const root = embla.rootNode();
    root?.addEventListener("mouseenter", parar);
    return () => { clearInterval(id); embla.off("pointerDown", parar); root?.removeEventListener("mouseenter", parar); };
  }, [embla, n]);

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

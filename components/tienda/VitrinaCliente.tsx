"use client";
// ─────────────────────────────────────────────────────────────────────────
//  VITRINA del cliente — banner PROFESIONAL de productos (con foto) en el cartón.
//  Reencarna el HeroCarrusel de la tienda como tarjeta de teléfono: una FOTO
//  grande protagonista por slide sobre panel blanco + halo menta + etiqueta de
//  precio flotante ámbar (estilo Mercado Libre) + la CUOTA como reina en verde +
//  pills de valor + CTA. Rota 4-6 destacados. CSS puro (translateX + utilidades
//  py-* que ya respetan reduced-motion): CERO librerías JS → no engorda la vista
//  del cliente/cobrador. Reemplaza la tarjetita chica anterior.
//  La lógica de plata (cuota con interés) es idéntica a la vitrina — no se toca.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { UYU } from "@/lib/format";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";

const FREC: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};
const INTERVALO = 6500; // tiempo de lectura de un adulto mayor

export function VitrinaCliente({
  productos,
  token,
}: {
  productos: ProductoParaCliente[];
  /** Con token → tienda del cliente; sin token (demo/pública) → tienda pública. */
  token?: string | null;
}) {
  // Banner 100% visual: solo productos CON foto (hasta 6).
  const slides = productos.filter((p) => p.fotos[0]).slice(0, 6);
  const n = slides.length;
  const [idx, setIdx] = useState(0);
  const [reduce, setReduce] = useState(false);
  const dragX = useRef<number | null>(null);
  const dragY = useRef<number | null>(null);

  useEffect(() => {
    setReduce(matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Auto-avance (pausado con reduced-motion, con 1 solo, o con la pestaña oculta).
  useEffect(() => {
    if (n <= 1 || reduce) return;
    const id = setInterval(() => {
      if (!document.hidden) setIdx((v) => (v + 1) % n);
    }, INTERVALO);
    return () => clearInterval(id);
  }, [n, reduce]);

  if (n === 0) return null;

  // Swipe barato: solo si el gesto es más horizontal que vertical (no pelea con
  // el scroll de la página). No pausa el auto-avance (para que la reseña lo vea rotar).
  function onDown(e: React.PointerEvent) {
    dragX.current = e.clientX;
    dragY.current = e.clientY;
  }
  function onUp(e: React.PointerEvent) {
    if (dragX.current == null || dragY.current == null) return;
    const dx = e.clientX - dragX.current;
    const dy = e.clientY - dragY.current;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      setIdx((v) => (v + (dx < 0 ? 1 : -1) + n) % n);
    }
    dragX.current = null;
    dragY.current = null;
  }

  return (
    <section
      className="py-reveal relative mx-auto w-full max-w-[440px] overflow-hidden rounded-[24px] shadow-[0_18px_44px_rgba(9,16,40,0.32)]"
      style={{ background: "linear-gradient(150deg,#2453DC 0%,#1E47C8 45%,#13308C 100%)" }}
      role="group"
      aria-roledescription="carrusel"
      aria-label="Productos de nuestra tienda"
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      {/* Brillo superior (profundidad, como el hero de la tienda). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(90% 90% at 88% -10%,rgba(255,255,255,0.16),transparent 55%)" }}
      />

      {/* Barra de auto-avance (se reinicia por slide → señal clara de que rota). */}
      {n > 1 && !reduce && (
        <span
          key={idx}
          aria-hidden
          className="py-banner-progress absolute left-0 top-0 z-30 h-[3px] w-full origin-left bg-white/85"
          style={{ "--dur": `${INTERVALO}ms` } as React.CSSProperties}
        />
      )}

      {/* Pista deslizante */}
      <div
        className="flex transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {slides.map((p) => (
          <Slide key={p.id} p={p} token={token} />
        ))}
      </div>

      {/* Puntos de navegación (área táctil ≥44px). */}
      {n > 1 && (
        <div className="relative z-20 flex justify-center gap-1 pb-2.5">
          {slides.map((p, k) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIdx(k)}
              aria-label={`Ir al producto ${k + 1}`}
              className="flex items-center px-1.5 pb-3 pt-1"
            >
              <span
                className={`h-1.5 rounded-full transition-all ${k === idx ? "w-5 bg-white" : "w-1.5 bg-white/40"}`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Slide({ p, token }: { p: ProductoParaCliente; token?: string | null }) {
  // Mismo cálculo que la vitrina: precio con interés → cuota (framing "N× $X").
  const conInteres = Math.round(p.precio * (1 + p.interesPct / 100));
  const cuota = p.cuotas > 0 ? Math.ceil(conInteres / p.cuotas) : 0;
  const oferta = p.precioAnterior > p.precio;
  const href = token ? `/c/${token}/tienda?producto=${p.id}` : `/tienda?producto=${p.id}`;

  return (
    <div className="relative flex min-w-0 flex-[0_0_100%] flex-col items-center gap-3 px-6 pt-7 pb-5 text-white">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#8FE7C0]">
        Nuestra tienda · a cuotas
      </span>

      {/* PROTAGONISTA: la foto, sobre panel blanco, con halo y sombra (levita). */}
      <div className="py-float relative mx-auto w-full max-w-[260px]">
        <div
          aria-hidden
          className="absolute -inset-6 -z-10 rounded-[36px] blur-2xl"
          style={{ background: "radial-gradient(circle at 50% 45%,#8FE7C055,transparent 68%)" }}
        />
        <div className="py-shine relative overflow-hidden rounded-[22px] bg-white p-3 shadow-[0_26px_54px_rgba(0,0,0,0.32)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.fotos[0]}
            alt={p.nombre}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="mx-auto aspect-square w-full max-w-[240px] select-none bg-white object-contain p-1"
          />
        </div>
        {/* Etiqueta de precio FLOTANTE (estilo Mercado Libre). */}
        <div className="absolute -right-2 -top-3 z-20 rounded-[14px] bg-[#E8A317] px-3 py-1.5 text-right shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
          {oferta && (
            <span className="block text-[9px] font-black uppercase leading-tight tracking-wide text-[#0F1B3D]/60">
              Oferta
            </span>
          )}
          <span className="block text-[17px] font-black leading-tight tabular-nums text-[#0F1B3D]">
            {UYU(p.precio)}
          </span>
        </div>
      </div>

      {/* Nombre (alto mínimo fijo para que el banner no salte entre slides). */}
      {p.marca && (
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8FE7C0]">{p.marca}</span>
      )}
      <span className="line-clamp-2 min-h-[2.2em] text-center text-[22px] font-black leading-[1.08] tracking-[-0.02em]">
        {p.nombre}
      </span>

      {/* CUOTA — la reina (lo que decide la compra a crédito). Verde tranquilizador. */}
      {cuota > 0 && p.cuotas > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#1FA971] px-4 py-2 text-[16px] font-extrabold text-white shadow-[0_6px_16px_rgba(31,169,113,0.30)] [font-variant-numeric:tabular-nums]">
          {p.cuotas}× {UYU(cuota)} {FREC[p.frecuencia]}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-[#1FA971] px-4 py-2 text-[16px] font-extrabold text-white shadow-[0_6px_16px_rgba(31,169,113,0.30)] [font-variant-numeric:tabular-nums]">
          {UYU(p.precio)}
        </span>
      )}
      {oferta && (
        <span className="-mt-1 text-[12px] font-semibold text-white/55 line-through [font-variant-numeric:tabular-nums]">
          {UYU(p.precioAnterior)}
        </span>
      )}

      {/* Pills de valor (confianza, gramática e-commerce). */}
      <div className="flex flex-wrap justify-center gap-2">
        <span className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-black text-[#13308C] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
          {p.interesPct === 0 ? "0% interés" : `${p.interesPct}% interés`}
        </span>
        <span className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-black text-[#13308C] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
          🚚 Entrega a domicilio
        </span>
      </div>

      {/* CTA ancho (objetivo táctil claro, ámbar sobre azul = máximo contraste). */}
      <Link
        href={href}
        className="mt-1 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#E8A317] px-5 text-[16px] font-extrabold text-[#0F1B3D] shadow-[0_8px_20px_rgba(0,0,0,0.22)] transition active:scale-[0.98]"
      >
        Ver en la tienda ›
      </Link>
    </div>
  );
}

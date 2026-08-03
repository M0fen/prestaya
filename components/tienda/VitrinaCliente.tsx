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
      className="py-reveal relative mx-auto w-full max-w-[440px] overflow-hidden rounded-[20px] shadow-[0_12px_28px_rgba(9,16,40,0.24)]"
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
    <div className="relative flex min-w-0 flex-[0_0_100%] items-center gap-3.5 px-4 py-4 pb-5 text-white">
      {/* IZQUIERDA: texto (eyebrow, nombre, cuota reina, CTA). */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#8FE7C0]">
          Nuestra tienda · a cuotas
        </span>
        <span className="line-clamp-2 text-[16.5px] font-black leading-[1.12] tracking-[-0.01em]">
          {p.nombre}
        </span>

        {/* CUOTA — la reina (lo que decide la compra a crédito). */}
        {cuota > 0 && p.cuotas > 0 ? (
          <span className="mt-0.5 w-fit rounded-full bg-[#1FA971] px-3 py-1.5 text-[14px] font-extrabold text-white shadow-[0_5px_14px_rgba(31,169,113,0.30)] [font-variant-numeric:tabular-nums]">
            {p.cuotas}× {UYU(cuota)} {FREC[p.frecuencia]}
          </span>
        ) : (
          <span className="mt-0.5 w-fit rounded-full bg-[#1FA971] px-3 py-1.5 text-[14px] font-extrabold text-white shadow-[0_5px_14px_rgba(31,169,113,0.30)] [font-variant-numeric:tabular-nums]">
            {UYU(p.precio)}
          </span>
        )}
        {/* No se anuncia la tasa: el cliente ve la CUOTA y el total, que es lo que
            de verdad va a pagar. Publicitar "0% interés" además de ser discutible
            (el costo ya está dentro del precio del producto) invita a comparar
            números que no significan lo mismo. */}
        <span className="text-[10.5px] font-semibold text-white/70">
          🚚 Entrega a domicilio
        </span>

        {/* CTA (objetivo táctil claro, ámbar sobre azul = máximo contraste). */}
        <Link
          href={href}
          className="mt-1.5 flex h-[42px] w-fit items-center justify-center gap-1 rounded-full bg-[#E8A317] px-4 text-[14px] font-extrabold text-[#0F1B3D] shadow-[0_6px_16px_rgba(0,0,0,0.20)] transition active:scale-[0.98]"
        >
          Ver en la tienda ›
        </Link>
      </div>

      {/* DERECHA: la FOTO, sobre panel blanco con halo + etiqueta de precio flotante. */}
      <div className="relative w-[132px] shrink-0">
        <div
          aria-hidden
          className="absolute -inset-3 -z-10 rounded-[28px] blur-2xl"
          style={{ background: "radial-gradient(circle at 50% 45%,#8FE7C055,transparent 68%)" }}
        />
        <div className="py-shine relative overflow-hidden rounded-[16px] bg-white p-2 shadow-[0_16px_34px_rgba(0,0,0,0.30)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.fotos[0]}
            alt={p.nombre}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="mx-auto aspect-square w-full select-none bg-white object-contain"
          />
        </div>
        {/* Etiqueta de precio FLOTANTE (estilo Mercado Libre). */}
        <div className="absolute -right-1.5 -top-2.5 z-20 rounded-[12px] bg-[#E8A317] px-2.5 py-1 text-right shadow-[0_8px_18px_rgba(0,0,0,0.32)]">
          {oferta && (
            <span className="block text-[8px] font-black uppercase leading-tight tracking-wide text-[#0F1B3D]/60">
              Oferta
            </span>
          )}
          <span className="block text-[14.5px] font-black leading-tight tabular-nums text-[#0F1B3D]">
            {UYU(p.precio)}
          </span>
        </div>
      </div>
    </div>
  );
}

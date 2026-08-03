"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Piezas reutilizables de la TIENDA (para no engordar TiendaCliente):
//   · GaleriaEmbla  — galería del producto con swipe/momentum (Embla) + dots +
//                     miniaturas + soporte de video, y tap → zoom a pantalla completa.
//   · Confeti       — celebración one-shot (CSS puro, sin dependencias) al confirmar.
//   · folioNuevo    — código de pedido legible (PY-XXXXXX) para el comprobante.
//   · pedidos local — registro de "mis pedidos" en el navegador (UX de estado
//                     "pendiente de aprobación" SIN tocar la base de datos).
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Drawer } from "vaul";
import { UYU } from "@/lib/format";

// ── ¿Estamos en desktop? (para que los drawers sean laterales en vez de bottom-sheet) ──
export function useEsDesktop(): boolean {
  const [d, setD] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setD(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return d;
}

/** Clases del Drawer.Content según viewport: lateral derecho en desktop, bottom-sheet en mobile.
 *  El fondo lo pone cada drawer (extra), porque varía (carrito blanco vs perfil gris). */
export function claseDrawer(esDesktop: boolean, extra = ""): string {
  return esDesktop
    ? `fixed inset-y-0 right-0 z-[75] flex h-full w-full max-w-[440px] flex-col shadow-[-16px_0_60px_rgba(15,27,61,0.28)] outline-none ${extra}`
    : `fixed inset-x-0 bottom-0 z-[75] mx-auto flex max-h-[92vh] w-full max-w-[460px] flex-col rounded-t-[24px] shadow-[0_-10px_60px_rgba(15,27,61,0.35)] outline-none ${extra}`;
}

// ── Galería del producto (Embla) ─────────────────────────────────────────────
export function GaleriaEmbla({
  fotos, videoUrl, nombre, ahorroPct, esCurbe, onZoom, onClose,
}: {
  fotos: string[];
  videoUrl: string | null;
  nombre: string;
  ahorroPct: number;
  esCurbe: boolean;
  onZoom: (i: number) => void;
  onClose: () => void;
}) {
  const total = fotos.length + (videoUrl ? 1 : 0);
  const [emblaRef, embla] = useEmblaCarousel({ loop: total > 1, align: "center" });
  const [sel, setSel] = useState(0);
  const ir = useCallback((k: number) => embla?.scrollTo(k), [embla]);

  useEffect(() => {
    if (!embla) return;
    const on = () => setSel(embla.selectedScrollSnap());
    embla.on("select", on);
    on();
    return () => { embla.off("select", on); };
  }, [embla]);

  // Sin fotos ni video: placeholder (con el ✕ para cerrar igual disponible).
  if (total === 0) {
    return (
      <div className="relative shrink-0">
        <div className="flex aspect-square w-full items-center justify-center bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)] text-[56px]">🛍️</div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-[15px] font-black text-tinta shadow active:scale-90">✕</button>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div className="relative">
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {fotos.map((src, k) => (
              <div key={k} className="relative aspect-square min-w-0 flex-[0_0_100%] bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={nombre} draggable={false} onClick={() => onZoom(k)} className="h-full w-full cursor-zoom-in select-none object-contain p-3" />
              </div>
            ))}
            {videoUrl && (
              <div className="relative aspect-square min-w-0 flex-[0_0_100%] bg-black">
                <video src={videoUrl} controls playsInline className="h-full w-full object-contain" />
              </div>
            )}
          </div>
        </div>

        {/* Badges de oferta / Curbe sobre la foto */}
        {ahorroPct > 0 && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[#D64545] px-2.5 py-1 text-[11px] font-black text-white shadow">−{ahorroPct}%</span>
        )}
        {esCurbe && (
          <span className={`pointer-events-none absolute left-3 ${ahorroPct > 0 ? "top-11" : "top-3"} rounded-full bg-[linear-gradient(135deg,#E8C56E,#C9A24B)] px-2.5 py-1 text-[11px] font-black text-[#3A2E0A] shadow`}>💎 Curbe</span>
        )}
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-[15px] font-black text-tinta shadow active:scale-90">✕</button>

        {/* Flechas (desktop) */}
        {total > 1 && (
          <>
            <button type="button" onClick={() => ir(sel - 1)} aria-label="Foto anterior" className="absolute left-2.5 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[16px] font-black text-tinta shadow-md active:scale-90 sm:flex">‹</button>
            <button type="button" onClick={() => ir(sel + 1)} aria-label="Foto siguiente" className="absolute right-2.5 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[16px] font-black text-tinta shadow-md active:scale-90 sm:flex">›</button>
          </>
        )}

        {/* Dots */}
        {total > 1 && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
            {Array.from({ length: total }).map((_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all ${k === sel ? "w-5 bg-[#1E47C8]" : "w-1.5 bg-[#C7D2EC]"}`} />
            ))}
          </div>
        )}
      </div>

      {/* Miniaturas */}
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {fotos.map((src, k) => (
            <button key={k} type="button" onClick={() => ir(k)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-[10px] border-2 bg-white ${sel === k ? "border-[#1E47C8]" : "border-[#ECEFF8]"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" draggable={false} className="h-full w-full select-none object-contain p-0.5" />
            </button>
          ))}
          {videoUrl && (
            <button type="button" onClick={() => ir(fotos.length)}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border-2 bg-[#0F1B3D] text-[18px] text-white ${sel === fotos.length ? "border-[#1E47C8]" : "border-[#ECEFF8]"}`}>▶</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Confeti (CSS puro, sin dependencias) ─────────────────────────────────────
const PALETA = ["#1E47C8", "#34E0A1", "#E8A317", "#E8C56E", "#E06A6A", "#8FE7C0"];
export function Confeti() {
  // Partículas generadas UNA vez (initializer de useState = impureza sancionada).
  const [parts] = useState(() =>
    Array.from({ length: 26 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      tx: (Math.random() * 2 - 1) * 60,
      delay: Math.random() * 0.15,
      dur: 0.9 + Math.random() * 0.7,
      color: PALETA[i % PALETA.length],
      size: 6 + Math.random() * 6,
      rot: Math.random() * 540,
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{`
        @keyframes confetiCae{0%{transform:translateY(-10%) rotate(0deg);opacity:1}100%{transform:translateY(340px) translateX(var(--tx)) rotate(var(--rot));opacity:0}}
        @media (prefers-reduced-motion: reduce){.confeti-part{display:none}}
      `}</style>
      {parts.map((p) => (
        <span key={p.id} className="confeti-part" style={{
          position: "absolute", top: 0, left: `${p.left}%`,
          width: p.size, height: p.size * 0.6, background: p.color, borderRadius: 2,
          ["--tx" as string]: `${p.tx}px`, ["--rot" as string]: `${p.rot}deg`,
          animation: `confetiCae ${p.dur}s ${p.delay}s cubic-bezier(.2,.6,.3,1) forwards`,
        } as React.CSSProperties} />
      ))}
    </div>
  );
}

// ── Folio del pedido + registro local de "mis pedidos" ───────────────────────
/** Código legible de pedido (sin caracteres ambiguos): PY-XXXXXX. */
export function folioNuevo(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let k = 0; k < 6; k++) out += abc[Math.floor(Math.random() * abc.length)];
  return `PY-${out}`;
}

export type PedidoLocal = {
  folio: string;
  fechaIso: string;
  items: { nombre: string; cantidad: number }[];
  total: number;
};

const clavePedidos = (scope: string) => `pedidos_tienda:${scope}`;

export function guardarPedidoLocal(scope: string, pedido: PedidoLocal): void {
  try {
    const prev = leerPedidosLocal(scope);
    const next = [pedido, ...prev].slice(0, 20); // últimos 20
    localStorage.setItem(clavePedidos(scope), JSON.stringify(next));
  } catch { /* sin storage: el comprobante en pantalla igual se muestra */ }
}

export function leerPedidosLocal(scope: string): PedidoLocal[] {
  try {
    const raw = localStorage.getItem(clavePedidos(scope));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PedidoLocal[]) : [];
  } catch {
    return [];
  }
}

// ── "Visto recientemente" — historial local de productos abiertos (como ML) ───
const claveVistos = (scope: string) => `vistos_tienda:${scope}`;
export function registrarVisto(scope: string, id: string): void {
  try {
    const prev = leerVistos(scope).filter((x) => x !== id);
    localStorage.setItem(claveVistos(scope), JSON.stringify([id, ...prev].slice(0, 12)));
  } catch { /* sin storage */ }
}
export function leerVistos(scope: string): string[] {
  try {
    const raw = localStorage.getItem(claveVistos(scope));
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? (a as string[]) : [];
  } catch { return []; }
}

// ── "Mis compras" — compra real según el perfil (empleado→a crédito, cliente→tienda) ──
export type CompraTienda = {
  id: string;
  nombre: string;
  foto: string | null;
  total: number;
  saldo: number;
  cuota: number;
  cuotas: number;
  estado: "activa" | "saldada" | "cancelada";
  fechaIso: string;
};

// ── SECCIÓN en TARJETA blanca (como los bloques de Mercado Libre) ────────────
/** Envuelve un bloque en una tarjeta blanca con título en negrita + "Ver todos ›".
 *  Sobre el fondo gris de la página, esto es lo que hace que las secciones "se vean". */
export function SeccionTienda({ titulo, verTodos, verTodosLabel = "Ver todos ›", children }: {
  titulo?: React.ReactNode;
  verTodos?: () => void;
  verTodosLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] bg-white p-3.5 shadow-[0_1px_5px_rgba(15,27,61,0.06)] md:p-4">
      {(titulo || verTodos) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[14.5px] font-extrabold tracking-[-0.01em] text-tinta">{titulo}</span>
          {verTodos && (
            <button type="button" onClick={verTodos} className="shrink-0 rounded-full px-2 py-1 text-[12px] font-bold text-azul active:scale-95">{verTodosLabel}</button>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// ── FILA horizontal con FLECHAS (el carrusel de estantería de un e-commerce) ──
/**
 * Contenedor scrolleable con botones ‹ › que aparecen SOLO en desktop y solo
 * cuando hay algo hacia ese lado. En el teléfono se desliza con el dedo (las
 * flechas serían ruido); en la computadora, sin flechas, un carrusel parece una
 * fila cortada — es lo que separa una estantería de verdad de un overflow.
 */
export function FilaScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [puede, setPuede] = useState({ izq: false, der: false });

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const margen = 8; // tolerancia: el scroll no siempre cae en el píxel exacto
    setPuede({
      izq: el.scrollLeft > margen,
      der: el.scrollLeft + el.clientWidth < el.scrollWidth - margen,
    });
  }, []);

  useEffect(() => {
    medir();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir, children]);

  const mover = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className="group/fila relative">
      <div ref={ref} onScroll={medir}
        className={`-mx-3.5 flex gap-2.5 overflow-x-auto scroll-smooth px-3.5 pb-1 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
        {children}
      </div>
      {([["izq", -1], ["der", 1]] as const).map(([lado, dir]) =>
        puede[lado] ? (
          <button key={lado} type="button" onClick={() => mover(dir)}
            aria-label={dir < 0 ? "Ver anteriores" : "Ver siguientes"}
            className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white text-[18px] font-bold text-tinta opacity-0 shadow-[0_2px_12px_rgba(15,27,61,0.22)] ring-1 ring-black/5 transition hover:scale-105 group-hover/fila:opacity-100 md:grid ${
              dir < 0 ? "-left-2" : "-right-2"
            }`}>
            {dir < 0 ? "‹" : "›"}
          </button>
        ) : null,
      )}
    </div>
  );
}

// ── BANNER promocional horizontal (como los de Electrolux/Motorola en ML) ────
export function BannerPromo({ tema = "azul", eyebrow, titulo, sub, badge, ctaLabel = "Ver todo →", img, onClick }: {
  tema?: "azul" | "oscuro" | "dorado";
  eyebrow?: string;
  titulo: string;
  sub?: string;
  badge?: string;
  ctaLabel?: string;
  img?: string | null;
  onClick: () => void;
}) {
  const bg = tema === "oscuro"
    ? "linear-gradient(120deg,#0F1B3D 0%,#1A2A57 100%)"
    : tema === "dorado"
      ? "linear-gradient(120deg,#1C1608 0%,#2C2211 100%)"
      : "linear-gradient(120deg,#2453DC 0%,#13308C 100%)";
  const acento = tema === "dorado" ? "#E8C56E" : "#8FE7C0";
  return (
    <button type="button" onClick={onClick}
      className="group relative flex items-stretch overflow-hidden rounded-[18px] text-left shadow-[0_10px_28px_rgba(15,27,61,0.25)] transition active:scale-[0.99]"
      style={{ background: bg }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 120% at 100% 0%, ${acento}22, transparent 55%)` }} />
      <div className="relative flex flex-1 flex-col justify-center gap-1 p-4 text-white md:p-5">
        {eyebrow && <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: acento }}>{eyebrow}</span>}
        <span className="text-[17px] font-black leading-tight tracking-[-0.01em] md:text-[21px]">{titulo}</span>
        {sub && <span className="text-[12px] font-medium text-white/70">{sub}</span>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {badge && <span className="rounded-full bg-white px-3 py-1 text-[11.5px] font-black text-[#13308C]">{badge}</span>}
          <span className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-bold text-white ring-1 ring-white/20 transition group-hover:bg-white/25">{ctaLabel}</span>
        </div>
      </div>
      {img && (
        <div className="relative flex w-[40%] max-w-[168px] shrink-0 items-center justify-center p-3">
          <div className="aspect-square w-full overflow-hidden rounded-[16px] bg-white p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" loading="lazy" className="h-full w-full object-contain" />
          </div>
        </div>
      )}
    </button>
  );
}

// ── Fila de ATAJOS (como "Compra tu carrito / Visto recientemente" de ML) ─────
export type Atajo = { key: string; icono: string; titulo: string; sub: string; onClick: () => void; tono?: string };
export function AtajosTienda({ atajos }: { atajos: Atajo[] }) {
  if (atajos.length === 0) return null;
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {atajos.map((a) => (
        <button key={a.key} type="button" onClick={a.onClick}
          className="flex w-[132px] shrink-0 flex-col gap-1.5 rounded-[16px] bg-white p-3 text-left shadow-[0_1px_5px_rgba(15,27,61,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,27,61,0.1)] active:scale-[0.98]">
          <span className="grid h-9 w-9 place-items-center rounded-full text-[18px]" style={{ background: a.tono ?? "#EEF3FF" }}>{a.icono}</span>
          <span className="text-[13px] font-extrabold leading-tight text-tinta">{a.titulo}</span>
          <span className="line-clamp-1 text-[11px] font-semibold text-gris">{a.sub}</span>
        </button>
      ))}
    </div>
  );
}

function fechaCorta(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-UY", { day: "numeric", month: "short" });
  } catch { return ""; }
}

// ── Íconos de línea para la barra de tienda ──────────────────────────────────
function IcoCorazon({ lleno = false }: { lleno?: boolean }) {
  return (<svg viewBox="0 0 24 24" width="21" height="21" fill={lleno ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20.5S3.5 15 3.5 8.9A4.4 4.4 0 0 1 12 6.9a4.4 4.4 0 0 1 8.5 2C20.5 15 12 20.5 12 20.5Z" /></svg>);
}
function IcoCarrito() {
  return (<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 4.5h2l1.7 10.2a1.4 1.4 0 0 0 1.4 1.2h7.2a1.4 1.4 0 0 0 1.4-1.1l1.3-6.4H6.4" /><circle cx="9.5" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></svg>);
}
function IcoPersona() {
  return (<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" /></svg>);
}

/** Botón de acción de la barra con badge de conteo (favoritos/carrito). */
function AccionBarra({ onClick, label, activo = false, badge = 0, badgeColor = "#E0245E", pop = 0, children }: {
  onClick: () => void; label: string; activo?: boolean; badge?: number; badgeColor?: string; pop?: number; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full text-white transition active:scale-90 ${activo ? "bg-white/20" : "hover:bg-white/15"}`}>
      {children}
      {badge > 0 && (
        <span key={pop} style={{ background: badgeColor }}
          className="absolute right-0 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black tabular-nums text-white shadow ring-2 ring-[#1E47C8] motion-safe:animate-[popBadge_0.3s_ease]">{badge}</span>
      )}
    </button>
  );
}

/**
 * CABECERA DE LA TIENDA (sticky, full-bleed): marca + BUSCADOR + acciones en UNA
 * sola banda de color, como la barra amarilla de Mercado Libre.
 *
 * Antes eran tres piezas apiladas —fila de marca, barra sticky y un input suelto
 * debajo—: ocupaban media pantalla de teléfono antes del primer producto y no
 * leían como una tienda, sino como tres widgets. Juntarlas en una banda le da a
 * la página el "chrome" que uno espera de un e-commerce, deja el buscador SIEMPRE
 * a mano (es la principal vía de compra en móvil) y recupera alto para el catálogo.
 */
export function BarraTienda({ titulo, favN, cartN, favActivo, onFav, onCart, onPerfil, pulso, q, onQ, placeholder = "Buscar en la tienda…", derecha }: {
  titulo: string; favN: number; cartN: number; favActivo: boolean;
  onFav: () => void; onCart: () => void; onPerfil: () => void; pulso: number;
  /** Buscador integrado (controlado por el padre, que es quien filtra). */
  q?: string;
  onQ?: (v: string) => void;
  placeholder?: string;
  /** Slot opcional a la derecha del título (ej. "Hola, Carlos" / "Ingresar"). */
  derecha?: React.ReactNode;
}) {
  const conBuscador = typeof q === "string" && !!onQ;
  return (
    // `before:` pinta la banda de lado a lado de la PANTALLA sin sacar el contenido
    // de la columna centrada: en desktop una cabecera que termina donde termina el
    // contenido se ve como un widget flotando, no como la barra de una tienda.
    // (La página raíz lleva overflow-x-clip para que el 100vw no genere scroll.)
    <div className="sticky top-0 z-40 -mx-[18px] px-[18px] pb-2.5 pt-2 shadow-[0_2px_14px_rgba(15,27,61,0.22)] before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-[100vw] before:-translate-x-1/2 before:bg-[linear-gradient(135deg,#2453DC,#13308C)] before:content-[''] md:-mx-8 md:px-8">
      <style>{`@keyframes popBadge{0%{transform:scale(1)}45%{transform:scale(1.5)}100%{transform:scale(1)}}`}</style>
      {/* Una sola fila que se REPARTE: en desktop marca · buscador · acciones (como
          la barra amarilla de ML). En teléfono el buscador salta a la línea de abajo
          a ancho completo, que es donde el pulgar lo alcanza. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="order-1 flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white/15 text-[15px] ring-1 ring-white/25">🛍️</span>
          <span className="truncate text-[15px] font-black tracking-[-0.01em] text-white">{titulo}</span>
        </button>
        <div className="order-2 ml-auto flex shrink-0 items-center gap-0.5 md:order-3 md:ml-0">
          {derecha}
          <AccionBarra onClick={onFav} label="Favoritos" activo={favActivo} badge={favN}><IcoCorazon lleno={favActivo || favN > 0} /></AccionBarra>
          <AccionBarra onClick={onCart} label="Carrito" badge={cartN} badgeColor="#00A650" pop={pulso}><IcoCarrito /></AccionBarra>
          <AccionBarra onClick={onPerfil} label="Mi tienda"><IcoPersona /></AccionBarra>
        </div>
        {conBuscador && (
          <div className="relative order-3 w-full md:order-2 md:min-w-[240px] md:flex-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-gris" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
            </svg>
            <input
              value={q}
              onChange={(e) => onQ!(e.target.value)}
              placeholder={placeholder}
              aria-label="Buscar productos"
              className="w-full rounded-[8px] border-0 bg-white py-2.5 pl-11 pr-10 text-[16px] text-tinta shadow-[0_2px_8px_rgba(0,0,0,0.14)] outline-none placeholder:text-gris focus:ring-2 focus:ring-white/70"
            />
            {q && (
              <button type="button" onClick={() => onQ!("")} aria-label="Limpiar búsqueda"
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[17px] font-bold text-gris hover:text-tinta">✕</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type FavItem = { id: string; nombre: string; foto: string | null; precio: number };

/** HUB "MI TIENDA" (perfil): COMPRAS reales (según el perfil) + pedidos + favoritos + ayuda. */
export function MiTienda({ open, onOpenChange, scope, titulo = "Mi tienda", compras = [], favoritos, onVerFavoritos, onQuitarFav, onAbrirProducto, soporte }: {
  open: boolean; onOpenChange: (o: boolean) => void; scope: string;
  titulo?: string;
  compras?: CompraTienda[];
  favoritos: FavItem[];
  onVerFavoritos: () => void;
  onQuitarFav: (id: string) => void;
  onAbrirProducto: (id: string) => void;
  soporte?: string | null;
}) {
  const [pedidos, setPedidos] = useState<PedidoLocal[]>([]);
  useEffect(() => { if (open) setPedidos(leerPedidosLocal(scope)); }, [open, scope]);
  const wa = soporte ? `https://wa.me/${soporte.replace(/[^\d]/g, "")}` : null;
  const debeTotal = compras.filter((c) => c.estado === "activa").reduce((a, c) => a + c.saldo, 0);
  const esDesktop = useEsDesktop();

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={esDesktop ? "right" : "bottom"}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[74] bg-black/55" />
        <Drawer.Content className={claseDrawer(esDesktop, "bg-[#F6F8FD]")}>
          <Drawer.Title className="sr-only">{titulo}</Drawer.Title>
          {!esDesktop && <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-[#E0E5F0]" aria-hidden />}
          {/* Encabezado del perfil */}
          <div className="flex items-center gap-3 px-5 pb-3 pt-2">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] text-white shadow-[0_6px_16px_rgba(19,48,140,0.35)]"><IcoPersona /></div>
            <div className="flex min-w-0 flex-col">
              <span className="text-[17px] font-extrabold text-tinta">{titulo}</span>
              <span className="text-[12px] font-medium text-gris">Compras, pedidos y favoritos</span>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Cerrar" className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-[14px] font-black text-tinta shadow-sm active:scale-90">✕</button>
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
            {/* Compras reales (según el perfil: empleado→a crédito, cliente→tienda). */}
            {compras.length > 0 && (
              <section className="flex flex-col gap-2 rounded-[16px] bg-white p-3.5 shadow-[0_1px_4px_rgba(15,27,61,0.05)]">
                <div className="flex items-center justify-between">
                  <span className="text-[13.5px] font-extrabold text-tinta">🛍️ Mis compras</span>
                  {debeTotal > 0 && <span className="rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11px] font-bold text-azul">Debés {UYU(debeTotal)}</span>}
                </div>
                {compras.map((c) => {
                  const pagado = Math.max(0, c.total - c.saldo);
                  const pct = c.total > 0 ? Math.min(100, Math.round((pagado / c.total) * 100)) : 0;
                  return (
                    <div key={c.id} className="flex flex-col gap-1.5 rounded-[12px] border border-[#EEF1F8] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-[13px] font-bold text-tinta">{c.nombre}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${c.estado === "saldada" ? "bg-[#E4F5EC] text-[#157A50]" : c.estado === "cancelada" ? "bg-[#F1F3F9] text-gris" : "bg-[#FDF3E2] text-[#B9770E]"}`}>{c.estado === "saldada" ? "Saldada ✓" : c.estado === "cancelada" ? "Cancelada" : `Debés ${UYU(c.saldo)}`}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-gris">{c.cuotas}× {UYU(c.cuota)} · empezó {fechaCorta(c.fechaIso)}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF1F8]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${pct}%` }} /></div>
                        <span className="text-[10.5px] font-bold tabular-nums text-gris">{UYU(pagado)} / {UYU(c.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Pedidos */}
            <section className="flex flex-col gap-2 rounded-[16px] bg-white p-3.5 shadow-[0_1px_4px_rgba(15,27,61,0.05)]">
              <span className="text-[13.5px] font-extrabold text-tinta">📦 Mis pedidos</span>
              {pedidos.length === 0 ? (
                <p className="py-3 text-center text-[12.5px] font-medium text-gris">Cuando envíes un pedido, aparece acá con su folio y estado.</p>
              ) : (
                pedidos.map((pe) => (
                  <div key={pe.folio} className="flex flex-col gap-1 rounded-[12px] border border-[#EEF1F8] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-black tracking-wide tabular-nums text-[#1E47C8]">{pe.folio}</span>
                      <span className="shrink-0 rounded-full bg-[#FDF3E2] px-2 py-0.5 text-[10px] font-black text-[#B9770E]">⏳ Pendiente</span>
                    </div>
                    <span className="text-[11.5px] font-semibold text-gris">{fechaCorta(pe.fechaIso)} · {pe.items.reduce((a, i) => a + i.cantidad, 0)} producto(s) · {UYU(pe.total)}</span>
                    <span className="line-clamp-2 text-[12px] font-medium text-cuerpo">{pe.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(" · ")}</span>
                  </div>
                ))
              )}
            </section>

            {/* Favoritos */}
            <section className="flex flex-col gap-2 rounded-[16px] bg-white p-3.5 shadow-[0_1px_4px_rgba(15,27,61,0.05)]">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-extrabold text-tinta">❤️ Favoritos <span className="text-gris">({favoritos.length})</span></span>
                {favoritos.length > 0 && (
                  <button type="button" onClick={() => { onVerFavoritos(); onOpenChange(false); }} className="rounded-full bg-[#EEF3FF] px-3 py-1 text-[11.5px] font-bold text-[#1E47C8] active:scale-95">Ver todos</button>
                )}
              </div>
              {favoritos.length === 0 ? (
                <p className="py-3 text-center text-[12.5px] font-medium text-gris">Tocá el 🤍 en un producto para guardarlo acá.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {favoritos.slice(0, 6).map((f) => (
                    <div key={f.id} className="relative overflow-hidden rounded-[12px] border border-[#EEF1F8]">
                      <button type="button" onClick={() => { onAbrirProducto(f.id); onOpenChange(false); }} className="flex w-full flex-col text-left active:scale-[0.98]">
                        <div className="aspect-[4/3] w-full bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)]">
                          {f.foto ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.foto} alt={f.nombre} loading="lazy" className="h-full w-full object-contain p-1.5" />
                          ) : <div className="flex h-full items-center justify-center text-[24px]">🛒</div>}
                        </div>
                        <div className="flex flex-col gap-0.5 px-2 py-1.5">
                          <span className="line-clamp-1 text-[11.5px] font-bold text-tinta">{f.nombre}</span>
                          <span className="text-[12px] font-black tabular-nums text-[#157A50]">{UYU(f.precio)}</span>
                        </div>
                      </button>
                      <button type="button" onClick={() => onQuitarFav(f.id)} aria-label="Quitar de favoritos" className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[13px] shadow-sm active:scale-90">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Ayuda */}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-[16px] bg-[#25D366] px-4 py-3 text-[13.5px] font-extrabold text-white shadow-[0_6px_16px_rgba(37,211,102,0.3)] active:scale-[0.99]">
                💬 ¿Necesitás ayuda? Escribinos
              </a>
            )}
            <p className="px-1 text-center text-[11px] font-medium text-gris">Tus pedidos y favoritos se guardan en este dispositivo. La oficina revisa cada pedido antes de aprobarlo.</p>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

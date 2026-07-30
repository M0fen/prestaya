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
import { useState, useEffect, useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Drawer } from "vaul";
import { UYU } from "@/lib/format";

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

// ── "Mis pedidos" — panel con los pedidos enviados desde este dispositivo ─────
function fechaCorta(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-UY", { day: "numeric", month: "short" });
  } catch { return ""; }
}

/** Botón + sheet "Mis pedidos" (se auto-oculta si no hay ninguno en este equipo). */
export function MisPedidos({ scope }: { scope: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  const [pedidos, setPedidos] = useState<PedidoLocal[]>([]);

  // Conteo tras montar (evita mismatch de hidratación: en SSR arranca en 0/oculto).
  useEffect(() => { setN(leerPedidosLocal(scope).length); }, [scope, open]);
  const abrir = () => { setPedidos(leerPedidosLocal(scope)); setOpen(true); };

  if (n === 0) return null;

  return (
    <>
      <button type="button" onClick={abrir}
        className="flex w-fit items-center gap-1.5 rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#1E47C8] shadow-sm transition active:scale-95">
        📦 Mis pedidos
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EEF3FF] px-1.5 text-[11px] font-black tabular-nums">{n}</span>
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[74] bg-black/55" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-[75] mx-auto flex max-h-[82vh] w-full max-w-[460px] flex-col rounded-t-[24px] bg-white shadow-[0_-10px_60px_rgba(15,27,61,0.35)] outline-none">
            <Drawer.Title className="sr-only">Mis pedidos</Drawer.Title>
            <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-[#E0E5F0]" aria-hidden />
            <div className="flex items-center justify-between px-5 pb-1 pt-2">
              <span className="text-[16px] font-extrabold text-tinta">📦 Mis pedidos</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F4FB] text-[14px] font-black text-tinta active:scale-90">✕</button>
            </div>
            <div className="flex flex-col gap-2.5 overflow-y-auto px-4 pb-6 pt-2">
              {pedidos.length === 0 ? (
                <p className="p-6 text-center text-[13px] font-medium text-gris">Todavía no enviaste pedidos desde este dispositivo.</p>
              ) : (
                pedidos.map((pe) => (
                  <div key={pe.folio} className="flex flex-col gap-1 rounded-[14px] border border-[#EEF1F8] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-black tracking-wide tabular-nums text-[#1E47C8]">{pe.folio}</span>
                      <span className="shrink-0 rounded-full bg-[#FDF3E2] px-2.5 py-1 text-[10.5px] font-black text-[#B9770E]">⏳ Pendiente de aprobación</span>
                    </div>
                    <span className="text-[11.5px] font-semibold text-gris">
                      {fechaCorta(pe.fechaIso)} · {pe.items.reduce((a, i) => a + i.cantidad, 0)} producto(s) · {UYU(pe.total)}
                    </span>
                    <span className="line-clamp-2 text-[12px] font-medium text-cuerpo">
                      {pe.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(" · ")}
                    </span>
                  </div>
                ))
              )}
              <p className="px-1 pt-1 text-center text-[11px] font-medium text-gris">
                Estos son los pedidos que enviaste desde este dispositivo. La oficina los revisa antes de aprobarlos.
              </p>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

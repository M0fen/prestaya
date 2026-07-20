"use client";
// Tienda del CLIENTE dentro del cartón: se siente como una tienda de
// electrodomésticos en cuotas. Banner del destacado + galería por categorías +
// modal de detalle con carrusel de fotos/video y "Me interesa" (lead, no crédito).
// Tono de la vista cliente: aspiracional, legible (adultos mayores), sin alarma.
import { useState, useTransition } from "react";
import { UYU } from "@/lib/format";
import { registrarInteres } from "@/app/c/[token]/actions";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";

const FREC_LABEL: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};

/** Precio final con interés + la cuota (para el framing "en N cuotas de $X"). */
function financiacion(p: ProductoParaCliente) {
  const conInteres = Math.round(p.precio * (1 + p.interesPct / 100));
  const cuota = p.cuotas > 0 ? Math.ceil(conInteres / p.cuotas) : 0;
  return { conInteres, cuota };
}

export function TiendaCliente({ productos, token }: { productos: ProductoParaCliente[]; token: string | null }) {
  const [abierto, setAbierto] = useState<ProductoParaCliente | null>(null);
  if (!productos || productos.length === 0) return null;

  const destacados = productos.filter((p) => p.destacado);
  const hero = destacados[0] ?? null;
  // Agrupar por categoría (respetando el orden de llegada, ya ordenado por el server).
  const grupos = new Map<string, ProductoParaCliente[]>();
  for (const p of productos) {
    const k = p.categoriaNombre ?? "Más productos";
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(p);
  }

  return (
    <section className="mt-2 flex flex-col gap-3">
      {/* Encabezado de la tienda */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[20px]" aria-hidden="true">🛍️</span>
        <div className="flex flex-col">
          <span className="text-[16px] font-extrabold tracking-[-0.01em] text-tinta">Nuestra tienda</span>
          <span className="text-[12.5px] font-medium text-gris">Llevate lo que necesitás, en cuotas cómodas.</span>
        </div>
      </div>

      {/* Banner del destacado */}
      {hero && (
        <button
          type="button"
          onClick={() => setAbierto(hero)}
          className="relative overflow-hidden rounded-[20px] text-left shadow-[0_10px_28px_rgba(19,48,140,0.14)] active:scale-[0.99]"
        >
          <div className="aspect-[16/10] w-full bg-[#EEF1F8]">
            {hero.fotos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero.fotos[0]} alt={hero.nombre} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[46px]">🧊</div>
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(9,17,40,0.9),rgba(9,17,40,0))] px-4 pb-3.5 pt-10">
            <span className="inline-block rounded-full bg-[#E8A317] px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-white">Destacado</span>
            <p className="mt-1.5 text-[19px] font-extrabold leading-tight text-white">{hero.nombre}</p>
            <PrecioLinea p={hero} tono="claro" />
          </div>
        </button>
      )}

      {/* Galería por categorías */}
      {[...grupos.entries()].map(([cat, items]) => (
        <div key={cat} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="text-[13px] font-extrabold text-tinta">{cat}</span>
            <span className="h-px flex-1 bg-linea" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setAbierto(p)}
                className="flex flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] active:scale-[0.98]"
              >
                <div className="aspect-square w-full bg-white">
                  {p.fotos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.fotos[0]} alt={p.nombre} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[34px]">🛒</div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  <span className="line-clamp-2 text-[13.5px] font-bold leading-tight text-tinta">{p.nombre}</span>
                  <PrecioLinea p={p} tono="oscuro" />
                  <span className="mt-1 w-fit rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11.5px] font-bold text-azul">Ver más detalle</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {abierto && <DetalleProducto p={abierto} token={token} onClose={() => setAbierto(null)} />}
    </section>
  );
}

/** Precio + framing en cuotas ("en 12 cuotas de $X por semana"). */
function PrecioLinea({ p, tono }: { p: ProductoParaCliente; tono: "claro" | "oscuro" }) {
  const { cuota } = financiacion(p);
  const c1 = tono === "claro" ? "text-white" : "text-[#1E47C8]";
  const c2 = tono === "claro" ? "text-white/85" : "text-gris";
  return (
    <div className="mt-0.5 flex flex-col">
      <span className={`text-[17px] font-black tabular-nums ${c1}`}>{UYU(p.precio)}</span>
      {p.cuotas > 0 && cuota > 0 && (
        <span className={`text-[11.5px] font-semibold ${c2}`}>
          o en {p.cuotas} cuotas de <b className="tabular-nums">{UYU(cuota)}</b> {FREC_LABEL[p.frecuencia]}
        </span>
      )}
    </div>
  );
}

function DetalleProducto({ p, token, onClose }: { p: ProductoParaCliente; token: string | null; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [pend, start] = useTransition();
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const { conInteres, cuota } = financiacion(p);
  const medios = p.fotos.length > 0 ? p.fotos : [];
  const total = medios.length + (p.videoUrl ? 1 : 0);
  const esVideo = p.videoUrl && i === medios.length;

  const interes = () =>
    start(async () => {
      if (!token) { setEstado("error"); setMsg("Volvé a abrir tu enlace para pedirlo."); return; }
      const r = await registrarInteres({ token, productoId: p.id });
      if (r.ok) { setEstado("ok"); setMsg(null); } else { setEstado("error"); setMsg(r.error); }
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[24px] bg-white sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Carrusel */}
        <div className="relative aspect-square w-full shrink-0 bg-[#F4F6FB]">
          {esVideo ? (
            <video src={p.videoUrl!} controls playsInline className="h-full w-full bg-black object-contain" />
          ) : medios[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={medios[i]} alt={p.nombre} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[52px]">🛍️</div>
          )}
          {total > 1 && (
            <>
              <button type="button" onClick={() => setI((x) => (x - 1 + total) % total)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-[16px] font-black text-tinta shadow">‹</button>
              <button type="button" onClick={() => setI((x) => (x + 1) % total)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-3 py-2 text-[16px] font-black text-tinta shadow">›</button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {Array.from({ length: total }).map((_, k) => (
                  <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-[#1E47C8]" : "w-1.5 bg-white/80"}`} />
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded-full bg-white/85 px-3 py-1.5 text-[14px] font-black text-tinta shadow">✕</button>
        </div>

        {/* Detalle */}
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1">
            {p.categoriaNombre && <span className="text-[11.5px] font-bold uppercase tracking-wide text-azul">{p.categoriaNombre}</span>}
            <h3 className="text-[21px] font-extrabold leading-tight text-tinta">{p.nombre}</h3>
          </div>

          {/* Precio y financiación — el corazón de la tienda de electro */}
          <div className="flex flex-col gap-1 rounded-[16px] bg-[#F1FBF6] px-4 py-3">
            <span className="text-[26px] font-black tabular-nums leading-none text-[#157A50]">{UYU(p.precio)}</span>
            {p.cuotas > 0 && cuota > 0 && (
              <span className="text-[14px] font-semibold text-cuerpo">
                o en <b>{p.cuotas} cuotas</b> de <b className="tabular-nums text-[#1E47C8]">{UYU(cuota)}</b> {FREC_LABEL[p.frecuencia]}
              </span>
            )}
            {p.interesPct > 0 && p.cuotas > 0 && (
              <span className="text-[12px] font-medium text-gris">Total en cuotas: <b className="tabular-nums">{UYU(conInteres)}</b> ({p.interesPct}% de interés)</span>
            )}
          </div>

          {p.descripcion && <p className="whitespace-pre-line text-[14px] leading-[1.55] text-cuerpo">{p.descripcion}</p>}

          {/* Me interesa */}
          {estado === "ok" ? (
            <div className="rounded-[14px] bg-[#E4F5EC] px-4 py-3 text-center">
              <p className="text-[15px] font-extrabold text-[#157A50]">¡Listo! 💚</p>
              <p className="text-[13px] font-medium text-[#3E8E67]">Anotamos tu interés. Tu cobrador te va a contar cómo llevártelo.</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={interes}
              disabled={pend}
              className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60"
            >
              {pend ? "Enviando…" : "Me interesa · Quiero saber más"}
            </button>
          )}
          {estado === "error" && msg && <p className="text-center text-[12.5px] font-semibold text-[#E06A6A]">{msg}</p>}
          <p className="pb-1 text-center text-[11px] font-medium text-tenue">Sin compromiso. Te contactamos para darte los detalles.</p>
        </div>
      </div>
    </div>
  );
}

"use client";
// Vitrina del CLIENTE: se siente como una tienda de electrodomésticos en cuotas.
// Buscador + chips de categoría + orden + fila de destacados + grilla de catálogo
// (marca, antes/ahora, "en N cuotas de $X") + modal de detalle con carrusel/video
// y "Me interesa" (lead, sin generar crédito). Tono cliente: claro, aspiracional.
import { useState, useMemo, useTransition } from "react";
import { UYU } from "@/lib/format";
import { registrarInteres } from "@/app/c/[token]/actions";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";

const FREC_LABEL: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};
type Orden = "destacados" | "menor" | "mayor";

/** Precio final con interés + la cuota (framing "en N cuotas de $X"). */
function financiacion(p: ProductoParaCliente) {
  const conInteres = Math.round(p.precio * (1 + p.interesPct / 100));
  const cuota = p.cuotas > 0 ? Math.ceil(conInteres / p.cuotas) : 0;
  return { conInteres, cuota };
}
// Quita acentos para que "heladera" matchee "Heladera" y "cafe" matchee "café".
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function TiendaCliente({
  productos, token, conEncabezado = true, abrirId = null, preview = false,
}: {
  productos: ProductoParaCliente[];
  token: string | null;
  conEncabezado?: boolean;
  /** Id de producto a abrir directo (deep-link desde el banner del cartón). */
  abrirId?: string | null;
  /** Vista previa del admin: se ve igual pero "Me interesa" queda desactivado. */
  preview?: boolean;
}) {
  // Si venimos del banner del cartón (?producto=id), abrimos su detalle de una.
  const [abierto, setAbierto] = useState<ProductoParaCliente | null>(
    () => (abrirId ? productos.find((p) => p.id === abrirId) ?? null : null),
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("destacados");

  const categorias = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of productos) { const k = p.categoriaNombre ?? "Más productos"; set.set(k, (set.get(k) ?? 0) + 1); }
    return [...set.entries()].map(([nombre, n]) => ({ nombre, n }));
  }, [productos]);

  const filtrados = useMemo(() => {
    const t = norm(q.trim());
    let r = productos.filter((p) => {
      if (cat && (p.categoriaNombre ?? "Más productos") !== cat) return false;
      if (!t) return true;
      return norm(`${p.nombre} ${p.marca ?? ""} ${p.categoriaNombre ?? ""} ${p.descripcion ?? ""}`).includes(t);
    });
    if (orden === "menor") r = [...r].sort((a, b) => a.precio - b.precio);
    else if (orden === "mayor") r = [...r].sort((a, b) => b.precio - a.precio);
    else r = [...r].sort((a, b) => Number(b.destacado) - Number(a.destacado));
    return r;
  }, [productos, q, cat, orden]);

  const destacados = productos.filter((p) => p.destacado);
  const hayFiltro = Boolean(q.trim() || cat);

  if (!productos || productos.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      {conEncabezado && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[20px]" aria-hidden="true">🛍️</span>
          <div className="flex flex-col">
            <span className="text-[16px] font-extrabold tracking-[-0.01em] text-tinta">Nuestra tienda</span>
            <span className="text-[12.5px] font-medium text-gris">Llevate lo que necesitás, en cuotas cómodas.</span>
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-gris">🔎</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar (heladera, LG, TV…)"
          className="w-full rounded-full border border-[#DCE3F4] bg-white py-2.5 pl-10 pr-4 text-[14px] outline-none focus:border-azul"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-gris">✕</button>
        )}
      </div>

      {/* Chips de categoría (scroll horizontal) */}
      <div className="-mx-[18px] flex gap-1.5 overflow-x-auto px-[18px] pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip activo={!cat} onClick={() => setCat(null)}>Todos</Chip>
        {categorias.map((c) => (
          <Chip key={c.nombre} activo={cat === c.nombre} onClick={() => setCat(cat === c.nombre ? null : c.nombre)}>
            {c.nombre}
          </Chip>
        ))}
      </div>

      {/* Destacados (solo sin filtro) */}
      {!hayFiltro && destacados.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[13px] font-extrabold text-tinta">⭐ Destacados</span>
          <div className="-mx-[18px] flex gap-3 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {destacados.map((p) => (
              <button key={p.id} type="button" onClick={() => setAbierto(p)}
                className="flex w-[160px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] active:scale-[0.98]">
                <Foto p={p} className="aspect-square" />
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  {p.marca && <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{p.marca}</span>}
                  <span className="line-clamp-2 text-[13px] font-bold leading-tight text-tinta">{p.nombre}</span>
                  <Precio p={p} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Barra de resultados + orden */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-gris">
          {filtrados.length} {filtrados.length === 1 ? "artículo" : "artículos"}{cat ? ` · ${cat}` : ""}
        </span>
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}
          className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1 text-[12px] font-semibold text-cuerpo outline-none">
          <option value="destacados">Destacados</option>
          <option value="menor">Menor precio</option>
          <option value="mayor">Mayor precio</option>
        </select>
      </div>

      {/* Grilla */}
      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[16px] border border-[#ECEFF8] bg-white px-6 py-10 text-center">
          <span className="text-[30px]" aria-hidden="true">🔍</span>
          <p className="text-[14px] font-bold text-tinta">No encontramos ese artículo</p>
          <p className="text-[12.5px] font-medium text-gris">Probá con otra palabra o mirá otra categoría.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtrados.map((p) => (
            <button key={p.id} type="button" onClick={() => setAbierto(p)}
              className="flex flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] active:scale-[0.98]">
              <div className="relative">
                <Foto p={p} className="aspect-square" />
                {p.agotado ? (
                  <span className="absolute left-2 top-2 rounded-full bg-[#6B7494] px-2 py-0.5 text-[10px] font-black text-white">Agotado</span>
                ) : p.precioAnterior > p.precio ? (
                  <span className="absolute left-2 top-2 rounded-full bg-[#D64545] px-2 py-0.5 text-[10px] font-black text-white">OFERTA</span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
                {p.marca && <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{p.marca}</span>}
                <span className="line-clamp-2 text-[13.5px] font-bold leading-tight text-tinta">{p.nombre}</span>
                <Precio p={p} />
                <span className="mt-1.5 w-fit rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11.5px] font-bold text-azul">Ver detalle</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="px-1 pt-1 text-center text-[11px] font-medium text-tenue">
        Precios de referencia. Tocá "Me interesa" y tu cobrador te pasa el precio y las cuotas para vos. 🙂
      </p>

      {abierto && <DetalleProducto p={abierto} token={token} preview={preview} onClose={() => setAbierto(null)} />}
    </section>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${activo ? "bg-[#1E47C8] text-white" : "border border-[#DCE3F4] bg-white text-cuerpo"}`}>
      {children}
    </button>
  );
}

function Foto({ p, className = "" }: { p: ProductoParaCliente; className?: string }) {
  return (
    <div className={`w-full bg-white ${className}`}>
      {p.fotos[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.fotos[0]} alt={p.nombre} className="h-full w-full object-contain p-1.5" />
      ) : (
        <div className="flex h-full items-center justify-center text-[34px]">🛒</div>
      )}
    </div>
  );
}

/** Precio con "antes" tachado (si hay oferta) + cuota. */
function Precio({ p }: { p: ProductoParaCliente }) {
  const { cuota } = financiacion(p);
  return (
    <div className="mt-0.5 flex flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[16px] font-black tabular-nums text-[#157A50]">{UYU(p.precio)}</span>
        {p.precioAnterior > p.precio && <span className="text-[11.5px] font-semibold tabular-nums text-tenue line-through">{UYU(p.precioAnterior)}</span>}
      </div>
      {p.cuotas > 0 && cuota > 0 && (
        <span className="text-[11px] font-semibold text-[#1E47C8]">{p.cuotas}× {UYU(cuota)} {FREC_LABEL[p.frecuencia]}</span>
      )}
    </div>
  );
}

function DetalleProducto({ p, token, onClose, preview = false }: { p: ProductoParaCliente; token: string | null; onClose: () => void; preview?: boolean }) {
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
      <div className="flex max-h-[92vh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[24px] bg-white sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-square w-full shrink-0 bg-[#F7F9FD]">
          {esVideo ? (
            <video src={p.videoUrl!} controls playsInline className="h-full w-full bg-black object-contain" />
          ) : medios[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={medios[i]} alt={p.nombre} className="h-full w-full object-contain p-2" />
          ) : (
            <div className="flex h-full items-center justify-center text-[52px]">🛍️</div>
          )}
          {total > 1 && (
            <>
              <button type="button" onClick={() => setI((x) => (x - 1 + total) % total)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-[16px] font-black text-tinta shadow">‹</button>
              <button type="button" onClick={() => setI((x) => (x + 1) % total)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-[16px] font-black text-tinta shadow">›</button>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {Array.from({ length: total }).map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-[#1E47C8]" : "w-1.5 bg-[#C7D2EC]"}`} />)}
              </div>
            </>
          )}
          <button type="button" onClick={onClose} className="absolute right-2 top-2 rounded-full bg-white/90 px-3 py-1.5 text-[14px] font-black text-tinta shadow">✕</button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] font-bold uppercase tracking-wide text-azul">{[p.marca, p.categoriaNombre].filter(Boolean).join(" · ")}</span>
            <h3 className="text-[21px] font-extrabold leading-tight text-tinta">{p.nombre}</h3>
          </div>

          <div className="flex flex-col gap-1 rounded-[16px] bg-[#F1FBF6] px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[26px] font-black tabular-nums leading-none text-[#157A50]">{UYU(p.precio)}</span>
              {p.precioAnterior > p.precio && <span className="text-[14px] font-semibold tabular-nums text-tenue line-through">{UYU(p.precioAnterior)}</span>}
            </div>
            {p.cuotas > 0 && cuota > 0 && (
              <span className="text-[14px] font-semibold text-cuerpo">o en <b>{p.cuotas} cuotas</b> de <b className="tabular-nums text-[#1E47C8]">{UYU(cuota)}</b> {FREC_LABEL[p.frecuencia]}</span>
            )}
            {p.interesPct > 0 && p.cuotas > 0 && (
              <span className="text-[12px] font-medium text-gris">Total en cuotas: <b className="tabular-nums">{UYU(conInteres)}</b> ({p.interesPct}% de interés)</span>
            )}
          </div>

          {p.descripcion && <p className="whitespace-pre-line text-[14px] leading-[1.55] text-cuerpo">{p.descripcion}</p>}

          {preview ? (
            <div className="w-full rounded-full bg-[#EEF3FF] px-5 py-3.5 text-center text-[14px] font-bold text-azul">
              Vista previa · así lo ve tu cliente
            </div>
          ) : estado === "ok" ? (
            <div className="rounded-[14px] bg-[#E4F5EC] px-4 py-3 text-center">
              <p className="text-[15px] font-extrabold text-[#157A50]">¡Listo! 💚</p>
              <p className="text-[13px] font-medium text-[#3E8E67]">Anotamos tu interés. Tu cobrador te va a contar cómo llevártelo.</p>
            </div>
          ) : p.agotado ? (
            <div className="w-full rounded-full bg-[#FBE4E2] px-5 py-3.5 text-center text-[15px] font-extrabold text-[#C0392B]">
              Sin stock por ahora 😔
            </div>
          ) : (
            <button type="button" onClick={interes} disabled={pend}
              className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60">
              {pend ? "Enviando…" : "Me interesa · Quiero saber más"}
            </button>
          )}
          {!preview && estado === "error" && msg && <p className="text-center text-[12.5px] font-semibold text-[#E06A6A]">{msg}</p>}
          <p className="pb-1 text-center text-[11px] font-medium text-tenue">Sin compromiso. Te contactamos para darte los detalles.</p>
        </div>
      </div>
    </div>
  );
}

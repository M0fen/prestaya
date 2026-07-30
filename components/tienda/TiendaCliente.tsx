"use client";
// Vitrina del CLIENTE: se siente como una tienda de electrodomésticos en cuotas.
// Buscador + chips de categoría + orden + fila de destacados + grilla de catálogo
// (marca, antes/ahora, "en N cuotas de $X") + modal de detalle con carrusel/video
// y "Me interesa" (lead, sin generar crédito). Tono cliente: claro, aspiracional.
import { useState, useMemo, useTransition } from "react";
import { UYU } from "@/lib/format";
import { registrarInteres } from "@/app/c/[token]/actions";
import { calcularPlanVenta } from "@/lib/venta";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";

const FREC_LABEL: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};
type Orden = "destacados" | "menor" | "mayor";

/** Cuota + TOTAL a cobrar (= cuota × cuotas), con la fórmula CANÓNICA (lib/venta), la
 *  misma que usa la conversión a crédito y el cartón → el cliente ve exactamente lo que
 *  va a pagar (antes se mostraba `conInteres`, que por el redondeo `ceil` quedaba por
 *  debajo del total real cuota×cuotas por unos pesos). */
function financiacion(p: ProductoParaCliente) {
  if (p.cuotas <= 0) return { total: 0, cuota: 0 };
  const plan = calcularPlanVenta({ precio: p.precio, interesPct: p.interesPct, cuotas: p.cuotas });
  return { total: plan.totalACobrar, cuota: plan.cuota };
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
  const [marca, setMarca] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("destacados");

  const categorias = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of productos) { const k = p.categoriaNombre ?? "Más productos"; set.set(k, (set.get(k) ?? 0) + 1); }
    return [...set.entries()].map(([nombre, n]) => ({ nombre, n }));
  }, [productos]);

  // Marcas presentes (para el filtro por marca, estilo e-commerce). Solo se muestran
  // si hay al menos 2 marcas distintas (si no, el filtro no aporta).
  const marcas = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of productos) { if (p.marca) set.set(p.marca, (set.get(p.marca) ?? 0) + 1); }
    return [...set.entries()].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
  }, [productos]);

  const filtrados = useMemo(() => {
    const t = norm(q.trim());
    let r = productos.filter((p) => {
      if (cat && (p.categoriaNombre ?? "Más productos") !== cat) return false;
      if (marca && p.marca !== marca) return false;
      if (!t) return true;
      return norm(`${p.nombre} ${p.marca ?? ""} ${p.categoriaNombre ?? ""} ${p.descripcion ?? ""}`).includes(t);
    });
    if (orden === "menor") r = [...r].sort((a, b) => a.precio - b.precio);
    else if (orden === "mayor") r = [...r].sort((a, b) => b.precio - a.precio);
    else r = [...r].sort((a, b) => Number(b.destacado) - Number(a.destacado));
    return r;
  }, [productos, q, cat, marca, orden]);

  const destacados = productos.filter((p) => p.destacado);
  const hayFiltro = Boolean(q.trim() || cat || marca);
  // Hero: el mejor destacado (primero en oferta, si hay). Solo sin filtro.
  const hero = !hayFiltro
    ? [...destacados].sort((a, b) => Number(b.precioAnterior > b.precio) - Number(a.precioAnterior > a.precio))[0] ?? null
    : null;

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

      {/* Filtro por MARCA (solo si hay 2+ marcas). Completa la sensación de e-commerce. */}
      {marcas.length >= 2 && (
        <div className="-mx-[18px] flex items-center gap-1.5 overflow-x-auto px-[18px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-[11px] font-bold text-gris">Marca:</span>
          <Chip activo={!marca} onClick={() => setMarca(null)}>Todas</Chip>
          {marcas.map((m) => (
            <Chip key={m.nombre} activo={marca === m.nombre} onClick={() => setMarca(marca === m.nombre ? null : m.nombre)}>{m.nombre}</Chip>
          ))}
        </div>
      )}

      {/* Hero: el destacado principal, grande (sensación de tienda). Solo sin filtro. */}
      {hero && (
        <button type="button" onClick={() => setAbierto(hero)}
          className="group overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#173063,#0F1B3D)] text-left shadow-[0_14px_34px_rgba(15,27,61,0.3)] active:scale-[0.99]">
          <div className="flex items-stretch">
            <div className="relative w-[42%] shrink-0 bg-white">
              <Foto p={hero} className="aspect-square" />
              {hero.precioAnterior > hero.precio && (
                <span className="absolute left-2 top-2 rounded-full bg-[#D64545] px-2 py-0.5 text-[10px] font-black text-white">OFERTA</span>
              )}
            </div>
            <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-3.5 text-white">
              <span className="text-[10.5px] font-black uppercase tracking-wide text-[#FFD37E]">⭐ Destacado</span>
              {hero.marca && <span className="text-[10px] font-bold uppercase tracking-wide text-white/45">{hero.marca}</span>}
              <span className="line-clamp-2 text-[16px] font-extrabold leading-tight">{hero.nombre}</span>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[21px] font-black tabular-nums leading-none text-[#34E0A1]">{UYU(hero.precio)}</span>
                {hero.precioAnterior > hero.precio && <span className="text-[12px] tabular-nums text-white/40 line-through">{UYU(hero.precioAnterior)}</span>}
              </div>
              {hero.cuotas > 0 && financiacion(hero).cuota > 0 && (
                <span className="text-[12px] font-semibold text-white/70">{hero.cuotas}× {UYU(financiacion(hero).cuota)} {FREC_LABEL[hero.frecuencia]}</span>
              )}
              <span className="mt-1.5 w-fit rounded-full bg-white px-3.5 py-1.5 text-[12px] font-extrabold text-[#13308C]">Ver oferta →</span>
            </div>
          </div>
        </button>
      )}

      {/* Más destacados (fila horizontal, excluye el hero). Solo sin filtro. */}
      {!hayFiltro && destacados.filter((p) => p.id !== hero?.id).length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[13px] font-extrabold text-tinta">⭐ Más destacados</span>
          <div className="-mx-[18px] flex gap-3 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {destacados.filter((p) => p.id !== hero?.id).map((p) => (
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
                {p.agotado || p.stock === 0 ? (
                  <span className="absolute left-2 top-2 rounded-full bg-[#6B7494] px-2 py-0.5 text-[10px] font-black text-white">Agotado</span>
                ) : p.stock != null && p.stock <= 5 ? (
                  <span className="absolute left-2 top-2 rounded-full bg-[#E8A317] px-2 py-0.5 text-[10px] font-black text-white">¡Últimas {p.stock}!</span>
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

      {abierto && (
        <DetalleProducto
          p={abierto}
          token={token}
          preview={preview}
          relacionados={relacionadosDe(abierto, productos)}
          onAbrirOtro={setAbierto}
          onClose={() => setAbierto(null)}
        />
      )}
    </section>
  );
}

/** "También te puede interesar": misma categoría primero, se completa con destacados/otros. */
function relacionadosDe(p: ProductoParaCliente, todos: ProductoParaCliente[]): ProductoParaCliente[] {
  const otros = todos.filter((x) => x.id !== p.id);
  const mismaCat = otros.filter((x) => x.categoriaNombre === p.categoriaNombre);
  const resto = otros.filter((x) => x.categoriaNombre !== p.categoriaNombre).sort((a, b) => Number(b.destacado) - Number(a.destacado));
  return [...mismaCat, ...resto].slice(0, 8);
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

function DetalleProducto({
  p, token, onClose, preview = false, relacionados, onAbrirOtro,
}: {
  p: ProductoParaCliente;
  token: string | null;
  onClose: () => void;
  preview?: boolean;
  relacionados: ProductoParaCliente[];
  onAbrirOtro: (p: ProductoParaCliente) => void;
}) {
  const [i, setI] = useState(0);
  const [pend, start] = useTransition();
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const { total: totalCuotas, cuota } = financiacion(p);
  const medios = p.fotos.length > 0 ? p.fotos : [];
  const total = medios.length + (p.videoUrl ? 1 : 0);
  const esVideo = p.videoUrl && i === medios.length;
  const ahorro = p.precioAnterior > p.precio ? p.precioAnterior - p.precio : 0;
  const ahorroPct = ahorro > 0 && p.precioAnterior > 0 ? Math.round((ahorro / p.precioAnterior) * 100) : 0;
  const sinStock = p.agotado || p.stock === 0;

  const interes = () =>
    start(async () => {
      if (!token) { setEstado("error"); setMsg("Volvé a abrir tu enlace para pedirlo."); return; }
      const r = await registrarInteres({ token, productoId: p.id });
      if (r.ok) { setEstado("ok"); setMsg(null); } else { setEstado("error"); setMsg(r.error); }
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[460px] flex-col overflow-hidden rounded-t-[26px] bg-white shadow-[0_24px_70px_rgba(15,27,61,0.4)] sm:rounded-[26px]" onClick={(e) => e.stopPropagation()}>
        {/* Galería con miniaturas */}
        <div className="shrink-0">
          <div className="relative aspect-square w-full bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)]">
            {esVideo ? (
              <video src={p.videoUrl!} controls playsInline className="h-full w-full bg-black object-contain" />
            ) : medios[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={medios[i]} alt={p.nombre} className="h-full w-full object-contain p-3" />
            ) : (
              <div className="flex h-full items-center justify-center text-[56px]">🛍️</div>
            )}
            {total > 1 && (
              <>
                <button type="button" onClick={() => setI((x) => (x - 1 + total) % total)} className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[16px] font-black text-tinta shadow-md active:scale-90">‹</button>
                <button type="button" onClick={() => setI((x) => (x + 1) % total)} className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[16px] font-black text-tinta shadow-md active:scale-90">›</button>
              </>
            )}
            {ahorroPct > 0 && !sinStock && (
              <span className="absolute left-3 top-3 rounded-full bg-[#D64545] px-2.5 py-1 text-[11px] font-black text-white shadow">−{ahorroPct}%</span>
            )}
            <button type="button" onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[14px] font-black text-tinta shadow active:scale-90">✕</button>
          </div>
          {total > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {medios.map((src, k) => (
                <button key={k} type="button" onClick={() => setI(k)}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-[10px] border-2 bg-white ${i === k ? "border-[#1E47C8]" : "border-[#ECEFF8]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-contain p-0.5" />
                </button>
              ))}
              {p.videoUrl && (
                <button type="button" onClick={() => setI(medios.length)}
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border-2 bg-[#0F1B3D] text-[18px] text-white ${esVideo ? "border-[#1E47C8]" : "border-[#ECEFF8]"}`}>▶</button>
              )}
            </div>
          )}
        </div>

        {/* Contenido */}
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1">
            {[p.marca, p.categoriaNombre].filter(Boolean).length > 0 && (
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-azul">{[p.marca, p.categoriaNombre].filter(Boolean).join(" · ")}</span>
            )}
            <h3 className="text-[22px] font-extrabold leading-tight text-tinta">{p.nombre}</h3>
          </div>

          {/* Precio + cuotas */}
          <div className="flex flex-col gap-1.5 rounded-[18px] border border-[#E4F0EA] bg-[#F4FBF7] px-4 py-3.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[28px] font-black tabular-nums leading-none text-[#157A50]">{UYU(p.precio)}</span>
              {ahorro > 0 && <span className="text-[15px] font-semibold tabular-nums text-tenue line-through">{UYU(p.precioAnterior)}</span>}
              {ahorro > 0 && <span className="rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[11px] font-black text-[#157A50]">Ahorrás {UYU(ahorro)}</span>}
            </div>
            {p.cuotas > 0 && cuota > 0 && (
              <div className="flex items-center gap-2 rounded-[12px] bg-white px-3 py-2">
                <span className="text-[18px]">💳</span>
                <span className="text-[14px] font-semibold text-cuerpo">
                  <b className="text-[#1E47C8]">{p.cuotas} cuotas</b> de <b className="tabular-nums text-[#1E47C8]">{UYU(cuota)}</b> {FREC_LABEL[p.frecuencia]}
                </span>
              </div>
            )}
            {p.interesPct > 0 && p.cuotas > 0 && (
              <span className="text-[12px] font-medium text-gris">Total en cuotas: <b className="tabular-nums">{UYU(totalCuotas)}</b> ({p.interesPct}% de interés)</span>
            )}
          </div>

          {/* Señales de confianza — le dan sensación de tienda seria. */}
          <div className="grid grid-cols-3 gap-2">
            <TrustItem icon="🚚" label="Entrega a domicilio" />
            <TrustItem icon="🛡️" label="Con garantía" />
            <TrustItem icon="🤝" label="Te lo lleva tu cobrador" />
          </div>

          {p.descripcion && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold uppercase tracking-wide text-gris">Descripción</span>
              <p className="whitespace-pre-line text-[14px] leading-[1.55] text-cuerpo">{p.descripcion}</p>
            </div>
          )}

          {p.stock != null && p.stock <= 5 && !sinStock && (
            <p className="rounded-[10px] bg-[#FDF3E2] px-3 py-2 text-center text-[13px] font-extrabold text-[#B9770E]">🔥 ¡Quedan solo {p.stock}! Apurate.</p>
          )}

          {/* También te puede interesar */}
          {relacionados.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-[#EEF1F8] pt-3">
              <span className="text-[13px] font-extrabold text-tinta">También te puede interesar</span>
              <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {relacionados.map((r) => (
                  <button key={r.id} type="button" onClick={() => { setI(0); setEstado("idle"); onAbrirOtro(r); }}
                    className="flex w-[130px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-[#ECEFF8] bg-white text-left active:scale-[0.98]">
                    <Foto p={r} className="aspect-square" />
                    <div className="flex flex-col gap-0.5 px-2.5 py-2">
                      <span className="line-clamp-2 text-[12px] font-bold leading-tight text-tinta">{r.nombre}</span>
                      <span className="text-[13px] font-black tabular-nums text-[#157A50]">{UYU(r.precio)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="h-1" />
        </div>

        {/* CTA fijo abajo (queda visible al scrollear la ficha). */}
        <div className="shrink-0 border-t border-[#EEF1F8] bg-white px-5 py-3">
          {preview ? (
            <div className="w-full rounded-full bg-[#EEF3FF] px-5 py-3 text-center text-[14px] font-bold text-azul">Vista previa · así lo ve tu cliente</div>
          ) : estado === "ok" ? (
            <div className="rounded-[14px] bg-[#E4F5EC] px-4 py-2.5 text-center">
              <p className="text-[15px] font-extrabold text-[#157A50]">¡Listo! 💚</p>
              <p className="text-[12.5px] font-medium text-[#3E8E67]">Tu cobrador te va a contar cómo llevártelo.</p>
            </div>
          ) : sinStock ? (
            <div className="w-full rounded-full bg-[#FBE4E2] px-5 py-3 text-center text-[15px] font-extrabold text-[#C0392B]">Sin stock por ahora 😔</div>
          ) : (
            <>
              <button type="button" onClick={interes} disabled={pend}
                className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60">
                {pend ? "Enviando…" : "Me interesa · Quiero saber más"}
              </button>
              {estado === "error" && msg && <p className="mt-1.5 text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
              <p className="mt-1.5 text-center text-[10.5px] font-medium text-tenue">Sin compromiso. Te contactamos para darte los detalles.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TrustItem({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-[12px] border border-[#ECEFF8] bg-[#FBFCFF] px-1.5 py-2 text-center">
      <span className="text-[17px]" aria-hidden>{icon}</span>
      <span className="text-[10.5px] font-bold leading-tight text-cuerpo">{label}</span>
    </div>
  );
}

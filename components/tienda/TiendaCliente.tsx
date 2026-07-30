"use client";
// Vitrina del CLIENTE: se siente como una tienda de electrodomésticos en cuotas.
// Buscador + chips de categoría + orden + fila de destacados + grilla de catálogo
// (marca, antes/ahora, "en N cuotas de $X") + modal de detalle con carrusel/video
// y "Me interesa" (lead, sin generar crédito). Tono cliente: claro, aspiracional.
import { useState, useMemo, useRef, useEffect, useTransition } from "react";
import { Drawer } from "vaul";
import { LazyMotion, domAnimation, m, MotionConfig } from "motion/react";
import { UYU } from "@/lib/format";
import { registrarInteres } from "@/app/c/[token]/actions";
import { pedirCarritoPublico } from "@/lib/acciones/leadsPublicos";
import { registrarInteresPublico } from "@/lib/acciones/leadsPublicos";
import { comprarComoEmpleado } from "@/lib/acciones/comprasEmpleado";
import { soloDigitos } from "@/lib/telefono";
import { calcularPlanVenta } from "@/lib/venta";
import type { ProductoParaCliente, FrecuenciaProducto } from "@/lib/data/tienda";
import { GaleriaEmbla, Confeti, folioNuevo, guardarPedidoLocal, BarraTienda, MiTienda, SeccionTienda, AtajosTienda, type Atajo } from "./piezas";

const FREC_LABEL: Record<FrecuenciaProducto, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};
type Orden = "destacados" | "menor" | "mayor";

/** Ítem del carrito (persistido en localStorage). */
type ItemCarrito = {
  id: string;
  nombre: string;
  precio: number;
  foto: string | null;
  cuota: number;
  cuotas: number;
  frecuencia: FrecuenciaProducto;
  cantidad: number;
};

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
  productos, token, conEncabezado = true, abrirId = null, preview = false, modoPublico = false, modoEmpleado = false,
}: {
  productos: ProductoParaCliente[];
  token: string | null;
  conEncabezado?: boolean;
  /** Id de producto a abrir directo (deep-link desde el banner del cartón). */
  abrirId?: string | null;
  /** Vista previa del admin: se ve igual pero "Me interesa" queda desactivado. */
  preview?: boolean;
  /** Tienda PÚBLICA (/tienda): visitante sin token → "Me interesa" pide contacto. */
  modoPublico?: boolean;
  /** El que mira es EMPLEADO logueado (cobrador/supervisor) → compra a crédito (0113). */
  modoEmpleado?: boolean;
}) {
  // Si venimos del banner del cartón (?producto=id), abrimos su detalle de una.
  const [abierto, setAbierto] = useState<ProductoParaCliente | null>(
    () => (abrirId ? productos.find((p) => p.id === abrirId) ?? null : null),
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [marca, setMarca] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("destacados");

  // ── CARRITO (público + cliente; el empleado compra directo, no usa carrito) ──
  const conCarrito = !preview && !modoEmpleado;
  const soporte = process.env.NEXT_PUBLIC_SOPORTE_WHATSAPP ?? null; // WhatsApp de ayuda (inlined en build)
  const CLAVE_CARRITO = `carrito:${token ?? "publico"}`;
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(false); // hub "Mi tienda"
  const [pulso, setPulso] = useState(0); // anima el badge del carrito al agregar
  // Cargar/guardar el carrito en el navegador (persiste entre visitas).
  useEffect(() => {
    try { const raw = localStorage.getItem(CLAVE_CARRITO); if (raw) setCarrito(JSON.parse(raw)); } catch { /* sin storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito)); } catch { /* sin storage */ }
  }, [carrito, CLAVE_CARRITO]);

  const agregarAlCarrito = (p: ProductoParaCliente) => {
    setCarrito((c) => {
      const ex = c.find((i) => i.id === p.id);
      if (ex) return c.map((i) => (i.id === p.id ? { ...i, cantidad: Math.min(50, i.cantidad + 1) } : i));
      if (c.length >= 20) return c; // tope de productos DISTINTOS por pedido (coherente con el server)
      return [...c, { id: p.id, nombre: p.nombre, precio: p.precio, foto: p.fotos[0] ?? null, cuota: financiacion(p).cuota, cuotas: p.cuotas, frecuencia: p.frecuencia, cantidad: 1 }];
    });
    setPulso((n) => n + 1);
  };
  const cambiarCantidad = (id: string, delta: number) =>
    setCarrito((c) => c.map((i) => (i.id === id ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i)));
  const quitarDelCarrito = (id: string) => setCarrito((c) => c.filter((i) => i.id !== id));
  const vaciarCarrito = () => setCarrito([]);
  const itemsCarrito = carrito.reduce((a, i) => a + i.cantidad, 0);

  const categorias = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of productos) { const k = p.categoriaNombre ?? "Más productos"; set.set(k, (set.get(k) ?? 0) + 1); }
    return [...set.entries()].map(([nombre, n]) => ({ nombre, n }));
  }, [productos]);

  // Marcas ACOTADAS a la categoría elegida (faceted search: no ofrecer filtros que
  // dan 0 resultados). Solo se muestran si hay ≥2 marcas distintas.
  const marcas = useMemo(() => {
    const base = cat ? productos.filter((p) => (p.categoriaNombre ?? "Más productos") === cat) : productos;
    const set = new Map<string, number>();
    for (const p of base) { if (p.marca) set.set(p.marca, (set.get(p.marca) ?? 0) + 1); }
    return [...set.entries()].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
  }, [productos, cat]);

  // FAVORITOS ❤️ (localStorage) — como los "guardados" de Mercado Libre.
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [soloFav, setSoloFav] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem("favoritos_tienda"); if (raw) setFavoritos(JSON.parse(raw)); } catch { /* sin storage */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("favoritos_tienda", JSON.stringify(favoritos)); } catch { /* sin storage */ }
  }, [favoritos]);
  const esFav = (id: string) => favoritos.includes(id);
  const toggleFav = (id: string) => setFavoritos((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  // Productos favoritos resueltos (para el hub "Mi tienda" y el estante de favoritos).
  const favProductos = useMemo(
    () => productos.filter((p) => favoritos.includes(p.id)),
    [productos, favoritos],
  );

  const filtrados = useMemo(() => {
    const t = norm(q.trim());
    let r = productos.filter((p) => {
      if (soloFav && !favoritos.includes(p.id)) return false;
      if (cat && (p.categoriaNombre ?? "Más productos") !== cat) return false;
      if (marca && p.marca !== marca) return false;
      if (!t) return true;
      return norm(`${p.nombre} ${p.marca ?? ""} ${p.categoriaNombre ?? ""} ${p.descripcion ?? ""}`).includes(t);
    });
    if (orden === "menor") r = [...r].sort((a, b) => a.precio - b.precio);
    else if (orden === "mayor") r = [...r].sort((a, b) => b.precio - a.precio);
    else r = [...r].sort((a, b) => Number(b.destacado) - Number(a.destacado));
    return r;
  }, [productos, q, cat, marca, orden, soloFav, favoritos]);

  const destacados = productos.filter((p) => p.destacado);
  const curbeProds = productos.filter((p) => p.proveedor === "curbe"); // colección de lujo (oro)
  const ofertas = useMemo(() => productos.filter((p) => p.precioAnterior > p.precio).sort((a, b) => (1 - a.precio / a.precioAnterior) < (1 - b.precio / b.precioAnterior) ? 1 : -1), [productos]);
  const hayFiltro = Boolean(q.trim() || cat || marca || soloFav);
  const limpiarTodo = () => { setQ(""); setCat(null); setMarca(null); setOrden("destacados"); setSoloFav(false); };
  // Hero: el mejor destacado (primero en oferta, si hay). Solo sin filtro.
  const hero = !hayFiltro
    ? [...destacados].sort((a, b) => Number(b.precioAnterior > b.precio) - Number(a.precioAnterior > a.precio))[0] ?? null
    : null;

  if (!productos || productos.length === 0) return null;

  return (
    <LazyMotion features={domAnimation}>
    <MotionConfig reducedMotion="user">
    <section className="flex flex-col gap-3">
      {conCarrito ? (
        /* BARRA STICKY: favoritos + carrito + Mi tienda siempre a la vista. */
        <BarraTienda
          titulo={modoPublico ? "Tienda Presta Ya" : "Nuestra tienda"}
          favN={favoritos.length}
          cartN={itemsCarrito}
          favActivo={soloFav}
          onFav={() => { setCat(null); setMarca(null); setSoloFav((v) => !v); }}
          onCart={() => setCarritoAbierto(true)}
          onPerfil={() => setPerfilAbierto(true)}
          pulso={pulso}
        />
      ) : conEncabezado ? (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[20px]" aria-hidden="true">🛍️</span>
          <div className="flex flex-col">
            <span className="text-[16px] font-extrabold tracking-[-0.01em] text-tinta">Nuestra tienda</span>
            <span className="text-[12.5px] font-medium text-gris">Llevate lo que necesitás, en cuotas cómodas.</span>
          </div>
        </div>
      ) : null}

      {/* Buscador PROTAGONISTA (search-first, como los mejores e-commerce). */}
      <div className="relative">
        <IconoLupa className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gris" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscá heladera, TV, perfume…"
          className="w-full rounded-full border border-[#DCE3F4] bg-white py-3.5 pl-12 pr-10 text-[16px] shadow-[0_2px_12px_rgba(15,27,61,0.06)] outline-none focus:border-azul focus:ring-2 focus:ring-[#1E47C8]/25"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-[17px] font-bold text-gris hover:text-tinta">✕</button>
        )}
      </div>

      {/* Fila de ATAJOS (como "Compra tu carrito / Visto recientemente" de ML). */}
      {conCarrito && !hayFiltro && (
        <AtajosTienda atajos={[
          ...(itemsCarrito > 0 ? [{ key: "carrito", icono: "🛒", titulo: "Tu carrito", sub: `${itemsCarrito} producto(s)`, onClick: () => setCarritoAbierto(true), tono: "#EEF3FF" }] : []),
          ...(favoritos.length > 0 ? [{ key: "fav", icono: "❤️", titulo: "Favoritos", sub: `${favoritos.length} guardado(s)`, onClick: () => { setCat(null); setMarca(null); setSoloFav(true); }, tono: "#FDE8EF" }] : []),
          ...(ofertas.length > 0 ? [{ key: "of", icono: "🔥", titulo: "Ofertas", sub: `${ofertas.length} en oferta`, onClick: () => document.getElementById("sec-ofertas")?.scrollIntoView({ behavior: "smooth", block: "start" }), tono: "#FBE4E2" }] : []),
          { key: "ped", icono: "📦", titulo: "Mis pedidos", sub: "Seguí tu pedido", onClick: () => setPerfilAbierto(true), tono: "#EAF7F0" },
          ...(soporte ? [{ key: "ayuda", icono: "💬", titulo: "Ayuda", sub: "Escribinos", onClick: () => window.open(`https://wa.me/${soporte.replace(/[^\d]/g, "")}`, "_blank") }] : []),
        ] as Atajo[]} />
      )}

      {/* Comprá por CATEGORÍA — sección en tarjeta (estilo Mercado Libre). */}
      <SeccionTienda titulo="Comprá por categoría">
        <div className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoriaTile emoji="🏬" nombre="Todo" n={productos.length} activo={!cat && !soloFav} onClick={() => { setCat(null); setSoloFav(false); }} />
          {categorias.map((c) => (
            <CategoriaTile key={c.nombre} emoji={emojiDe(c.nombre)} nombre={c.nombre} n={c.n}
              activo={cat === c.nombre} onClick={() => { setSoloFav(false); setCat(cat === c.nombre ? null : c.nombre); }} />
          ))}
          {favoritos.length > 0 && (
            <CategoriaTile emoji="❤️" nombre="Favoritos" n={favoritos.length} activo={soloFav} onClick={() => { setCat(null); setSoloFav(!soloFav); }} />
          )}
        </div>
        {/* Filtro por MARCA (solo si hay 2+ marcas). */}
        {marcas.length >= 2 && (
          <div className="mt-2.5 -mx-3.5 flex items-center gap-1.5 overflow-x-auto border-t border-[#F1F4FB] px-3.5 pt-2.5 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 text-[11px] font-bold text-gris">Marca:</span>
            <Chip activo={!marca} onClick={() => setMarca(null)}>Todas</Chip>
            {marcas.map((m) => (
              <Chip key={m.nombre} activo={marca === m.nombre} onClick={() => setMarca(marca === m.nombre ? null : m.nombre)}>{m.nombre}</Chip>
            ))}
          </div>
        )}
      </SeccionTienda>

      {/* Hero: el destacado principal, grande (sensación de tienda). Solo sin filtro. */}
      {hero && (
        <button type="button" onClick={() => setAbierto(hero)}
          className="group overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#173063,#0F1B3D)] text-left shadow-[0_14px_34px_rgba(15,27,61,0.3)] active:scale-[0.99]">
          <div className="flex items-stretch">
            {/* En público desktop el hero no debe volverse un cuadro gigante: capamos la foto. */}
            <div className={`relative w-[42%] shrink-0 bg-white ${modoPublico ? "md:w-[320px]" : ""}`}>
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

      {/* 🔥 OFERTAS — el gancho más fuerte (sección en tarjeta, como Mercado Libre). */}
      {!hayFiltro && ofertas.length > 0 && (
        <div id="sec-ofertas" className="scroll-mt-16">
        <SeccionTienda titulo={<span className="text-[#C0392B]">🔥 Ofertas</span>}>
          <div className="-mx-3.5 flex gap-3 overflow-x-auto px-3.5 pb-1 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ofertas.map((p) => (
              <button key={p.id} type="button" onClick={() => setAbierto(p)}
                className="group flex w-[160px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,27,61,0.12)] active:scale-[0.98]">
                <div className="relative overflow-hidden">
                  <Foto p={p} className="aspect-square" />
                  <span className="absolute left-2 top-2 rounded-full bg-[#D64545] px-2 py-0.5 text-[11px] font-black text-white shadow">−{Math.round((1 - p.precio / p.precioAnterior) * 100)}%</span>
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  <span className="line-clamp-2 text-[13px] font-bold leading-tight text-tinta">{p.nombre}</span>
                  <Precio p={p} />
                </div>
              </button>
            ))}
          </div>
        </SeccionTienda>
        </div>
      )}

      {/* ❤️ Tus favoritos — estante personal (sección en tarjeta, sin filtro). */}
      {!hayFiltro && favProductos.length > 0 && (
        <SeccionTienda titulo={<span className="text-[#E0245E]">❤️ Tus favoritos</span>} verTodos={() => { setCat(null); setMarca(null); setSoloFav(true); }}>
          <div className="-mx-3.5 flex gap-3 overflow-x-auto px-3.5 pb-1 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {favProductos.map((p) => (
              <button key={p.id} type="button" onClick={() => setAbierto(p)}
                className="group flex w-[160px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,27,61,0.12)] active:scale-[0.98]">
                <div className="relative overflow-hidden">
                  <Foto p={p} className="aspect-square" />
                  <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[15px] shadow-sm">❤️</span>
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  <span className="line-clamp-2 text-[13px] font-bold leading-tight text-tinta">{p.nombre}</span>
                  <Precio p={p} />
                </div>
              </button>
            ))}
          </div>
        </SeccionTienda>
      )}

      {/* Más destacados (sección en tarjeta, excluye el hero). Solo sin filtro. */}
      {!hayFiltro && destacados.filter((p) => p.id !== hero?.id).length > 0 && (
        <SeccionTienda titulo="⭐ Más destacados">
          <div className="-mx-3.5 flex gap-3 overflow-x-auto px-3.5 pb-1 md:-mx-4 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {destacados.filter((p) => p.id !== hero?.id).map((p) => (
              <button key={p.id} type="button" onClick={() => setAbierto(p)}
                className="group flex w-[160px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,27,61,0.12)] active:scale-[0.98]">
                <div className="relative overflow-hidden">
                  <Foto p={p} className="aspect-square" />
                  {p.precioAnterior > p.precio && (
                    <span className="absolute left-2 top-2 rounded-full bg-[#D64545] px-2 py-0.5 text-[11px] font-black text-white shadow">−{Math.round((1 - p.precio / p.precioAnterior) * 100)}%</span>
                  )}
                  {p.proveedor === "curbe" && (
                    <span className="absolute right-2 top-2 rounded-full bg-[linear-gradient(135deg,#E8C56E,#C9A24B)] px-1.5 py-0.5 text-[10px] font-black text-[#3A2E0A] shadow">💎</span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2.5">
                  {p.proveedor === "curbe" ? (
                    <span className="w-fit rounded-full bg-[linear-gradient(135deg,#FBF3DE,#F4E7C3)] px-2 py-0.5 text-[9.5px] font-black text-[#8A6A16]">💎 Curbe</span>
                  ) : p.marca ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{p.marca}</span>
                  ) : null}
                  <span className="line-clamp-2 text-[13px] font-bold leading-tight text-tinta">{p.nombre}</span>
                  <Precio p={p} />
                </div>
              </button>
            ))}
          </div>
        </SeccionTienda>
      )}

      {/* Colección CURBE — banner de ORO + fila de piezas (más visibilidad al lujo). */}
      {!hayFiltro && curbeProds.length > 0 && (
        <div className="flex flex-col gap-2.5 overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#1C1608,#2C2211)] p-4 shadow-[0_10px_28px_rgba(28,22,8,0.28)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-[14px] font-black tracking-[-0.01em] text-[#E8C56E]">💎 Colección Curbe</span>
              <span className="text-[11.5px] font-medium text-[#CBB98A]">Perfumes de autor y joyas de oro 18k italiano</span>
            </div>
            <a href="https://curbe.uy" target="_blank" rel="noopener noreferrer"
              className="shrink-0 rounded-full bg-[linear-gradient(135deg,#E8C56E,#C9A24B)] px-3 py-1.5 text-[11.5px] font-black text-[#2A2110] shadow">curbe.uy →</a>
          </div>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {curbeProds.map((p) => (
              <button key={p.id} type="button" onClick={() => setAbierto(p)}
                className="flex w-[148px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-[#4A3D1E] bg-[#0E0B04] text-left active:scale-[0.98]">
                <div className="relative">
                  <Foto p={p} className="aspect-square" />
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-[linear-gradient(135deg,#E8C56E,#C9A24B)] px-1.5 py-0.5 text-[9.5px] font-black text-[#3A2E0A] shadow">💎</span>
                </div>
                <div className="flex flex-col gap-0.5 px-2.5 py-2">
                  <span className="line-clamp-2 text-[12px] font-bold leading-tight text-white">{p.nombre}</span>
                  {p.cuotas > 0 && financiacion(p).cuota > 0 && (
                    <span className="text-[12px] font-black tabular-nums text-[#E8C56E]">{p.cuotas}× {UYU(financiacion(p).cuota)}</span>
                  )}
                  <span className="text-[10.5px] font-semibold tabular-nums text-[#CBB98A]">{UYU(p.precio)} contado</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros ACTIVOS (chips removibles) + "Ver todo". STICKY: el reset queda
          siempre a la vista aunque bajes por la grilla (como Zara/Uniqlo). */}
      {hayFiltro && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[14px] border border-[#E4E9F5] bg-white px-3 py-2 shadow-[0_1px_4px_rgba(15,27,61,0.05)]">
          <span className="text-[11.5px] font-bold text-gris">Filtrando:</span>
          {soloFav && <FiltroChip label="❤️ Favoritos" onQuitar={() => setSoloFav(false)} />}
          {q.trim() && <FiltroChip label={`“${q.trim()}”`} onQuitar={() => setQ("")} />}
          {cat && <FiltroChip label={cat} onQuitar={() => setCat(null)} />}
          {marca && <FiltroChip label={marca} onQuitar={() => setMarca(null)} />}
          <button type="button" onClick={limpiarTodo}
            className="ml-auto rounded-full bg-[#1E47C8] px-3 py-1 text-[11.5px] font-bold text-white active:scale-95">
            Ver todo
          </button>
        </div>
      )}

      {/* Catálogo — sección en TARJETA (título + orden + grilla). */}
      <section className="rounded-[18px] bg-white p-3.5 shadow-[0_1px_5px_rgba(15,27,61,0.06)] md:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-extrabold tracking-[-0.01em] text-tinta">
          {hayFiltro ? `${filtrados.length} ${filtrados.length === 1 ? "resultado" : "resultados"}${cat ? ` · ${cat}` : ""}` : "Todos los productos"}
        </span>
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}
          className="rounded-full border border-[#DCE3F4] bg-white px-3 py-1.5 text-[16px] font-semibold text-cuerpo outline-none">
          <option value="destacados">Destacados</option>
          <option value="menor">Menor precio</option>
          <option value="mayor">Mayor precio</option>
        </select>
      </div>

      {/* Grilla */}
      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[16px] border border-[#ECEFF8] bg-white px-6 py-10 text-center">
          <span className="text-[30px]" aria-hidden="true">🔍</span>
          <p className="text-[15px] font-bold text-tinta">No encontramos eso por ahora</p>
          <p className="text-[13px] font-medium text-gris">Probá con otra palabra, mirá otra categoría, o escribinos y lo conseguimos.</p>
          {hayFiltro && (
            <button type="button" onClick={limpiarTodo}
              className="mt-1 rounded-full bg-[#1E47C8] px-4 py-2 text-[12.5px] font-bold text-white active:scale-95">
              Ver todos los productos
            </button>
          )}
        </div>
      ) : (
        // En la tienda PÚBLICA la grilla crece en desktop (2→3→4 col); en el cartón
        // del cliente queda en 2 (se ve en el teléfono, no tocamos su densidad).
        <div className={`grid gap-3 grid-cols-2 ${modoPublico ? "sm:grid-cols-3 lg:grid-cols-4" : ""}`}>
          {filtrados.map((p, idx) => (
            <m.div key={p.id} role="button" tabIndex={0} onClick={() => setAbierto(p)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAbierto(p); } }}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={{ y: -3 }}
              viewport={{ once: true, margin: "0px 0px -40px 0px" }}
              transition={{ duration: 0.32, delay: Math.min(idx * 0.025, 0.25), ease: [0.2, 0.7, 0.2, 1] }}
              className="group flex cursor-pointer flex-col overflow-hidden rounded-[16px] border border-[#ECEFF8] bg-white text-left shadow-[0_2px_10px_rgba(15,27,61,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#D5DEF3] hover:shadow-[0_10px_24px_rgba(15,27,61,0.12)] focus-visible:ring-2 focus-visible:ring-[#1E47C8]/40">
              <div className="relative overflow-hidden">
                <div className="transition-transform duration-300 group-hover:scale-[1.04]">
                  <Foto p={p} className="aspect-square" />
                </div>
                {/* Descuento −X% (gancho más fuerte que "OFERTA") y escasez PUEDEN coexistir. */}
                {p.agotado || p.stock === 0 ? (
                  <span className="absolute left-2 top-2 rounded-full bg-[#6B7494] px-2 py-0.5 text-[10px] font-black text-white">Agotado</span>
                ) : (
                  <>
                    {p.precioAnterior > p.precio && (
                      <span className="absolute left-2 top-2 rounded-full bg-[#D64545] px-2 py-0.5 text-[11px] font-black text-white shadow">−{Math.round((1 - p.precio / p.precioAnterior) * 100)}%</span>
                    )}
                    {p.stock != null && p.stock <= 5 && (
                      <span className={`absolute left-2 ${p.precioAnterior > p.precio ? "top-9" : "top-2"} rounded-full bg-[#E8A317] px-2 py-0.5 text-[10px] font-black text-white`}>¡Últimas {p.stock}!</span>
                    )}
                  </>
                )}
                {/* Favorito ❤️ (guardar, como Mercado Libre) — bien visible sobre la foto. */}
                <button type="button" onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}
                  aria-label={esFav(p.id) ? "Quitar de favoritos" : "Guardar en favoritos"}
                  className={`absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-[19px] shadow-[0_3px_10px_rgba(15,27,61,0.22)] ring-1 backdrop-blur transition hover:scale-110 active:scale-90 ${esFav(p.id) ? "bg-white ring-[#F3C6D2]" : "bg-white/95 ring-black/5"}`}>
                  <m.span key={esFav(p.id) ? "on" : "off"} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 12 }}>
                    {esFav(p.id) ? "❤️" : "🤍"}
                  </m.span>
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
                {p.proveedor === "curbe" ? (
                  <span className="w-fit rounded-full bg-[linear-gradient(135deg,#FBF3DE,#F4E7C3)] px-2 py-0.5 text-[9.5px] font-black text-[#8A6A16]">💎 Curbe</span>
                ) : p.marca ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{p.marca}</span>
                ) : null}
                <span className="line-clamp-2 text-[14.5px] font-bold leading-snug text-tinta">{p.nombre}</span>
                <Precio p={p} />
                {conCarrito && !(p.agotado || p.stock === 0) && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); agregarAlCarrito(p); }}
                    className="mt-1.5 flex items-center justify-center gap-1.5 rounded-full bg-[#EEF3FF] py-2 text-[13px] font-bold text-azul transition hover:bg-[#1E47C8] hover:text-white active:scale-95">
                    Agregar al carrito
                  </button>
                )}
              </div>
            </m.div>
          ))}
        </div>
      )}
      </section>

      <p className="px-1 pt-1 text-center text-[12px] font-medium text-gris">
        Precios de referencia. Tocá "Me interesa" y tu cobrador te pasa el precio y las cuotas para vos. 🙂
      </p>

      <DetalleSheet
        producto={abierto}
        token={token}
        preview={preview}
        modoPublico={modoPublico}
        modoEmpleado={modoEmpleado}
        conCarrito={conCarrito}
        onAgregar={agregarAlCarrito}
        productos={productos}
        onAbrirOtro={setAbierto}
        onClose={() => setAbierto(null)}
      />

      {/* FAB flotante "Ver carrito" — refuerzo al scrollear (además del ícono de la barra). */}
      {conCarrito && itemsCarrito > 0 && !carritoAbierto && (
        <m.button type="button" onClick={() => setCarritoAbierto(true)}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.95 }}
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full bg-[#1E47C8] px-4 py-3 text-[14px] font-extrabold text-white shadow-[0_10px_28px_rgba(19,48,140,0.4)]">
          <span className="text-[18px]">🛒</span>
          <span>Ver carrito</span>
          <m.span key={pulso} initial={{ scale: 1 }} animate={{ scale: [1, 1.35, 1] }} transition={{ duration: 0.35 }}
            className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-[12px] font-black text-[#1E47C8]">{itemsCarrito}</m.span>
        </m.button>
      )}
      {conCarrito && (
        <>
          <CarritoSheet
            open={carritoAbierto}
            onOpenChange={setCarritoAbierto}
            items={carrito}
            token={token}
            scope={token ?? "publico"}
            modoPublico={modoPublico}
            onCambiarCantidad={cambiarCantidad}
            onQuitar={quitarDelCarrito}
            onVaciar={vaciarCarrito}
          />
          <MiTienda
            open={perfilAbierto}
            onOpenChange={setPerfilAbierto}
            scope={token ?? "publico"}
            favoritos={favProductos.map((p) => ({ id: p.id, nombre: p.nombre, foto: p.fotos[0] ?? null, precio: p.precio }))}
            onVerFavoritos={() => { setCat(null); setMarca(null); setSoloFav(true); }}
            onQuitarFav={toggleFav}
            onAbrirProducto={(id) => { const pp = productos.find((x) => x.id === id); if (pp) setAbierto(pp); }}
            soporte={process.env.NEXT_PUBLIC_SOPORTE_WHATSAPP ?? null}
          />
        </>
      )}
    </section>
    </MotionConfig>
    </LazyMotion>
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

// ── Íconos SVG de línea (premium; reemplazan emojis en la UI funcional) ──────
function IconoLupa({ className = "" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className={className} aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>);
}
function IconoCamion({ className = "" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d="M3 6.5h10.5v9.5H3z" /><path d="M13.5 9.5H17l3.5 3.5v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="17.5" cy="18" r="1.7" /></svg>);
}
function IconoEscudo({ className = "" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>);
}
function IconoCasa({ className = "" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></svg>);
}
function IconoTarjeta({ className = "" }: { className?: string }) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 9.5h18" /></svg>);
}

/** Ícono de categoría (perfumería/joyería Curbe + electrodomésticos). */
const EMOJI_CAT: Record<string, string> = { "Para Ella": "🌸", "Para Él": "🧔", Unisex: "✨", "Oro 18k": "💍" };
function emojiDe(nombre: string): string {
  if (EMOJI_CAT[nombre]) return EMOJI_CAT[nombre];
  const n = nombre.toLowerCase();
  if (n.includes("helad")) return "❄️";
  if (n.includes("tv") || n.includes("televis")) return "📺";
  if (n.includes("lava")) return "🫧";
  if (n.includes("cocina")) return "🍳";
  if (n.includes("aire")) return "🌬️";
  if (n.includes("micro")) return "🍽️";
  if (n.includes("celular") || n.includes("smart")) return "📱";
  if (n.includes("note") || n.includes("compu")) return "💻";
  if (n.includes("termo")) return "🔥";
  if (n.includes("ventil")) return "🌀";
  if (n.includes("perfum") || n.includes("fragan")) return "🌸";
  return "🛍️";
}

/** Tile de categoría (ícono + nombre + conteo), estilo Mercado Libre. */
function CategoriaTile({ emoji, nombre, n, activo, onClick }: { emoji: string; nombre: string; n: number; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex min-w-[74px] shrink-0 flex-col items-center gap-1 rounded-[14px] border px-2.5 py-2.5 transition active:scale-95 ${activo ? "border-[#1E47C8] bg-[#EEF3FF]" : "border-[#ECEFF8] bg-white hover:border-[#D5DEF3] hover:shadow-[0_4px_14px_rgba(15,27,61,0.08)]"}`}>
      <span className="text-[22px] leading-none" aria-hidden>{emoji}</span>
      <span className={`max-w-[74px] truncate text-center text-[12px] font-bold leading-tight ${activo ? "text-[#1E47C8]" : "text-cuerpo"}`}>{nombre}</span>
      <span className="text-[10px] font-semibold text-gris tabular-nums">{n}</span>
    </button>
  );
}

/** Chip de un filtro activo, con ✕ para quitarlo (patrón e-commerce). */
function FiltroChip({ label, onQuitar }: { label: string; onQuitar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#DCE3F4] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-cuerpo">
      {label}
      <button type="button" onClick={onQuitar} aria-label={`Quitar filtro ${label}`} className="text-[13px] font-black leading-none text-gris hover:text-tinta">×</button>
    </span>
  );
}

function Foto({ p, className = "" }: { p: ProductoParaCliente; className?: string }) {
  return (
    <div className={`w-full bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)] ${className}`}>
      {p.fotos[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.fotos[0]} alt={p.nombre} loading="lazy" decoding="async" className="h-full w-full object-contain p-2" />
      ) : (
        <div className="flex h-full items-center justify-center text-[34px]">🛒</div>
      )}
    </div>
  );
}

/** Precio con la CUOTA como protagonista (el negocio es cuotas) + "sin interés". */
function Precio({ p }: { p: ProductoParaCliente }) {
  const { cuota } = financiacion(p);
  const conCuota = p.cuotas > 0 && cuota > 0;
  const enOferta = p.precioAnterior > p.precio;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {conCuota && (
        <span className="w-fit rounded-md bg-[#EEF3FF] px-1.5 py-0.5 text-[13.5px] font-black tabular-nums text-[#1E47C8]">
          {p.cuotas}× {UYU(cuota)}
        </span>
      )}
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`font-black tabular-nums text-[#157A50] ${conCuota ? "text-[13px]" : "text-[16.5px]"}`}>{UYU(p.precio)}</span>
        {enOferta && <span className="text-[11px] font-semibold tabular-nums text-tenue line-through">{UYU(p.precioAnterior)}</span>}
        {conCuota && p.interesPct === 0 && <span className="rounded-full bg-[#E4F5EC] px-1.5 py-[1px] text-[10px] font-bold text-[#157A50]">sin interés</span>}
      </div>
    </div>
  );
}

/** Barra de progreso del checkout (Revisar → Datos → Listo). */
function PasosCheckout({ paso, conDatos }: { paso: 0 | 1 | 2; conDatos: boolean }) {
  const labels = conDatos ? ["Tu pedido", "Tus datos", "Listo"] : ["Tu pedido", "Confirmar", "Listo"];
  return (
    <div className="flex items-center gap-1.5 px-1">
      {labels.map((l, k) => (
        <div key={k} className="flex flex-1 flex-col items-center gap-1">
          <div className={`h-1.5 w-full rounded-full transition-colors ${k <= paso ? "bg-[#1E47C8]" : "bg-[#E4E9F5]"}`} />
          <span className={`text-[10px] font-bold ${k <= paso ? "text-[#1E47C8]" : "text-gris"}`}>{l}</span>
        </div>
      ))}
    </div>
  );
}

/** Carrito + CHECKOUT multi-paso (Vaul bottom-sheet). El pedido queda PENDIENTE
 *  DE APROBACIÓN: el flujo público crea leads y el del cliente crea solicitudes,
 *  que el admin revisa antes de convertir en venta. */
function CarritoSheet({
  open, onOpenChange, items, token, scope, modoPublico, onCambiarCantidad, onQuitar, onVaciar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: ItemCarrito[];
  token: string | null;
  scope: string;
  modoPublico: boolean;
  onCambiarCantidad: (id: string, delta: number) => void;
  onQuitar: (id: string) => void;
  onVaciar: () => void;
}) {
  const [pend, start] = useTransition();
  const [paso, setPaso] = useState<"revisar" | "datos">("revisar");
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [folio, setFolio] = useState<string | null>(null);
  const totalContado = items.reduce((a, i) => a + i.precio * i.cantidad, 0);
  const totalCuota = items.reduce((a, i) => a + i.cuota * i.cantidad, 0);

  // Al abrir el carrito, arrancar siempre en "revisar" y limpiar un éxito anterior.
  useEffect(() => {
    if (open) { setPaso("revisar"); setEstado("idle"); setMsg(null); setFolio(null); }
  }, [open]);

  // Confirma el pedido → server action (queda pendiente de aprobación) → éxito + folio.
  const confirmar = () =>
    start(async () => {
      setMsg(null);
      if (items.length === 0) return;
      if (modoPublico) {
        if (nombre.trim().length < 2) { setEstado("error"); setMsg("Poné tu nombre."); return; }
        if (soloDigitos(tel).length < 6) { setEstado("error"); setMsg("Poné un teléfono/WhatsApp válido."); return; }
        const r = await pedirCarritoPublico({
          items: items.map((i) => ({ productoId: i.id, productoNombre: i.nombre, cantidad: i.cantidad })),
          nombre: nombre.trim(), telefono: tel.trim(),
        });
        if (!r.ok) { setEstado("error"); setMsg(r.error); return; }
      } else if (token) {
        // Chequear CADA resultado: no confirmar "enviado" ni vaciar si alguno falló
        // (registrarInteres no lanza; devuelve {ok:false} por stock/rate-limit/audiencia).
        const rs = await Promise.all(items.map((it) => registrarInteres({ token, productoId: it.id })));
        if (rs.some((r) => !r.ok)) {
          setEstado("error");
          setMsg("No pudimos registrar todos los productos. Probá de nuevo en un rato.");
          return;
        }
      } else {
        setEstado("error"); setMsg("Volvé a abrir tu enlace para pedir."); return;
      }
      // Éxito: generar folio, dejar rastro local ("mis pedidos") y celebrar.
      const f = folioNuevo();
      guardarPedidoLocal(scope, {
        folio: f,
        fechaIso: new Date().toISOString(),
        items: items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad })),
        total: totalContado,
      });
      setFolio(f);
      setEstado("ok");
      onVaciar();
    });

  const idxPaso: 0 | 1 | 2 = estado === "ok" ? 2 : paso === "datos" ? 1 : 0;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[74] bg-black/55" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[75] mx-auto flex max-h-[92vh] w-full max-w-[460px] flex-col rounded-t-[24px] bg-white shadow-[0_-10px_60px_rgba(15,27,61,0.35)] outline-none">
          <Drawer.Title className="sr-only">Tu carrito y checkout</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-[#E0E5F0]" aria-hidden />

          {estado === "ok" ? (
            /* ── Comprobante: pedido PENDIENTE DE APROBACIÓN ── */
            <div className="relative flex flex-col items-center gap-3 p-6 text-center">
              <Confeti />
              <m.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E4F5EC] text-[34px]">✅</m.div>
              <div className="flex flex-col gap-1">
                <p className="text-[19px] font-extrabold text-tinta">¡Pedido enviado!</p>
                <span className="mx-auto rounded-full bg-[#FDF3E2] px-3 py-1 text-[12px] font-black text-[#B9770E]">⏳ Pendiente de aprobación</span>
              </div>
              {folio && (
                <div className="rounded-[12px] border border-dashed border-[#C7D2EC] bg-[#F7F9FF] px-4 py-2">
                  <span className="text-[11px] font-semibold text-gris">Tu folio</span>
                  <p className="text-[18px] font-black tracking-wider tabular-nums text-[#1E47C8]">{folio}</p>
                </div>
              )}
              <p className="max-w-[280px] text-[13px] font-medium text-gris">
                {modoPublico ? "Lo revisamos y te contactamos para coordinar el precio y las cuotas." : "Tu cobrador lo revisa y te confirma el plan. ¡Gracias!"}
              </p>
              <button type="button" onClick={() => onOpenChange(false)} className="mt-1 w-full rounded-full bg-[#1E47C8] px-5 py-3 text-[14px] font-extrabold text-white active:scale-[0.99]">Seguir viendo</button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="text-[44px]" aria-hidden>🛒</span>
              <p className="text-[16px] font-bold text-tinta">Tu carrito está vacío</p>
              <p className="max-w-[240px] text-[13px] font-medium text-gris">Agregá productos y pedilos todos juntos.</p>
              <button type="button" onClick={() => onOpenChange(false)} className="mt-1 rounded-full bg-[#1E47C8] px-5 py-2.5 text-[13.5px] font-bold text-white">Ver productos</button>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-5 pb-2 pt-1"><PasosCheckout paso={idxPaso} conDatos={modoPublico} /></div>

              {paso === "revisar" ? (
                <>
                  <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
                    {items.map((it) => (
                      <div key={it.id} className="flex gap-3 rounded-[14px] border border-[#EEF1F8] p-2.5">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-[linear-gradient(180deg,#FBFCFF,#F1F4FB)]">
                          {it.foto ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.foto} alt={it.nombre} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[22px]">🛒</div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 text-[13px] font-bold leading-tight text-tinta">{it.nombre}</span>
                          {it.cuotas > 0 && it.cuota > 0 && <span className="text-[12px] font-black tabular-nums text-[#1E47C8]">{it.cuotas}× {UYU(it.cuota)}</span>}
                          <span className="text-[11.5px] font-semibold tabular-nums text-[#157A50]">{UYU(it.precio)} contado</span>
                          <div className="mt-1 flex items-center gap-2.5">
                            <div className="flex items-center rounded-full border border-[#DCE3F4]">
                              <button type="button" onClick={() => onCambiarCantidad(it.id, -1)} aria-label="Menos" className="flex h-11 w-11 items-center justify-center text-[20px] font-black text-gris">−</button>
                              <span className="w-6 text-center text-[14px] font-bold tabular-nums">{it.cantidad}</span>
                              <button type="button" onClick={() => onCambiarCantidad(it.id, 1)} aria-label="Más" className="flex h-11 w-11 items-center justify-center text-[20px] font-black text-gris">+</button>
                            </div>
                            <button type="button" onClick={() => onQuitar(it.id)} className="rounded-full px-2 py-2 text-[12px] font-bold text-[#C0392B]">Quitar</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2.5 border-t border-[#EEF1F8] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-gris">Total contado</span>
                      <span className="text-[18px] font-black tabular-nums text-[#157A50]">{UYU(totalContado)}</span>
                    </div>
                    {totalCuota > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-gris">En cuotas (aprox.)</span>
                        <span className="text-[13px] font-bold tabular-nums text-[#1E47C8]">≈ {UYU(totalCuota)} por período</span>
                      </div>
                    )}
                    <button type="button" disabled={pend}
                      onClick={() => (modoPublico ? setPaso("datos") : confirmar())}
                      className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60">
                      {pend ? "Enviando…" : modoPublico ? "Continuar" : "Confirmar pedido"}
                    </button>
                    {estado === "error" && msg && <p className="text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
                    <button type="button" onClick={onVaciar} className="text-center text-[11.5px] font-semibold text-gris hover:text-tinta">Vaciar carrito</button>
                    <p className="text-center text-[11px] font-medium text-gris">Sin compromiso · el pedido queda pendiente de aprobación.</p>
                  </div>
                </>
              ) : (
                /* ── Paso DATOS (solo público) ── */
                <div className="flex flex-col gap-3 p-5">
                  <div className="rounded-[14px] bg-[#F7F9FF] px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-semibold text-gris">{items.reduce((a, i) => a + i.cantidad, 0)} producto(s)</span>
                      <span className="text-[15px] font-black tabular-nums text-[#157A50]">{UYU(totalContado)}</span>
                    </div>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-bold text-cuerpo">Tu nombre</span>
                    <input value={nombre} onChange={(e) => { setNombre(e.target.value); setMsg(null); }} placeholder="Nombre y apellido" maxLength={80} autoComplete="name" autoFocus
                      className="rounded-[12px] border border-[#DCE3F4] px-3.5 py-2.5 text-[16px] text-tinta outline-none focus:border-azul" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] font-bold text-cuerpo">Teléfono / WhatsApp</span>
                    <input value={tel} onChange={(e) => { setTel(e.target.value); setMsg(null); }} placeholder="099 123 456" type="tel" inputMode="tel" maxLength={30} autoComplete="tel"
                      className="rounded-[12px] border border-[#DCE3F4] px-3.5 py-2.5 text-[16px] text-tinta outline-none focus:border-azul" />
                  </label>
                  <button type="button" onClick={confirmar} disabled={pend}
                    className="mt-1 w-full rounded-full bg-[#157A50] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(21,122,80,0.28)] active:scale-[0.99] disabled:opacity-60">
                    {pend ? "Enviando…" : "Confirmar pedido"}
                  </button>
                  {estado === "error" && msg && <p className="text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
                  <button type="button" onClick={() => setPaso("revisar")} className="text-center text-[12.5px] font-semibold text-gris hover:text-tinta">← Volver al pedido</button>
                </div>
              )}
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Envuelve la ficha del producto en un Drawer (Vaul): bottom-sheet con arrastre
 *  para cerrar. Mantiene el producto "vivo" durante la animación de salida y
 *  remonta la ficha en cada apertura (estado fresco) vía `seq`. */
function DetalleSheet({
  producto, token, preview, modoPublico, modoEmpleado, conCarrito, onAgregar, productos, onAbrirOtro, onClose,
}: {
  producto: ProductoParaCliente | null;
  token: string | null;
  preview: boolean;
  modoPublico: boolean;
  modoEmpleado: boolean;
  conCarrito: boolean;
  onAgregar: (p: ProductoParaCliente) => void;
  productos: ProductoParaCliente[];
  onAbrirOtro: (p: ProductoParaCliente) => void;
  onClose: () => void;
}) {
  const [vivo, setVivo] = useState<ProductoParaCliente | null>(producto);
  const [seq, setSeq] = useState(0);
  useEffect(() => { if (producto) { setVivo(producto); setSeq((s) => s + 1); } }, [producto]);
  return (
    <Drawer.Root open={!!producto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/55" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[71] mx-auto flex max-h-[94vh] w-full max-w-[480px] flex-col rounded-t-[26px] bg-white shadow-[0_-12px_60px_rgba(15,27,61,0.4)] outline-none">
          <Drawer.Title className="sr-only">{vivo?.nombre ?? "Producto"}</Drawer.Title>
          <div className="mx-auto mt-2 h-1.5 w-11 shrink-0 rounded-full bg-[#E0E5F0]" aria-hidden />
          {vivo && (
            <DetalleProducto
              key={`${vivo.id}:${seq}`}
              p={vivo}
              token={token}
              preview={preview}
              modoPublico={modoPublico}
              modoEmpleado={modoEmpleado}
              conCarrito={conCarrito}
              onAgregar={onAgregar}
              relacionados={relacionadosDe(vivo, productos)}
              onAbrirOtro={onAbrirOtro}
              onClose={onClose}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DetalleProducto({
  p, token, onClose, preview = false, modoPublico = false, modoEmpleado = false, conCarrito = false, onAgregar, relacionados, onAbrirOtro,
}: {
  p: ProductoParaCliente;
  token: string | null;
  onClose: () => void;
  preview?: boolean;
  modoPublico?: boolean;
  modoEmpleado?: boolean;
  conCarrito?: boolean;
  onAgregar?: (p: ProductoParaCliente) => void;
  relacionados: ProductoParaCliente[];
  onAbrirOtro: (p: ProductoParaCliente) => void;
}) {
  const [pend, start] = useTransition();
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [form, setForm] = useState(false); // form de contacto abierto (modo público)
  // Compra del EQUIPO (0113): cuotas elegidas + nonce estable por apertura (idempotencia).
  const [cuotasEmp, setCuotasEmp] = useState(6);
  const opRef = useRef<string>(""); // se genera al primer click (no en render: crypto es impuro)
  const cuotaEmp = Math.ceil(p.precio / Math.max(1, cuotasEmp)); // interés 0 (perk del equipo)
  const superaTope = p.precio > 30000;
  const { total: totalCuotas, cuota } = financiacion(p);
  // Simulador de cuotas para el cliente: elegir el plazo y ver la cuota estimada.
  const [plazoSel, setPlazoSel] = useState(p.cuotas);
  const plazos = p.cuotas > 1
    ? [...new Set([Math.max(1, Math.round(p.cuotas / 2)), p.cuotas, Math.round(p.cuotas * 1.5)])].filter((n) => n >= 1 && n <= 1000).sort((a, b) => a - b)
    : [];
  const cuotaSel = plazoSel === p.cuotas ? cuota : Math.ceil(totalCuotas / Math.max(1, plazoSel));
  const ahorro = p.precioAnterior > p.precio ? p.precioAnterior - p.precio : 0;
  const ahorroPct = ahorro > 0 && p.precioAnterior > 0 ? Math.round((ahorro / p.precioAnterior) * 100) : 0;
  const sinStock = p.agotado || p.stock === 0;
  const [compartido, setCompartido] = useState(false);
  const [zoomIdx, setZoomIdx] = useState<number | null>(null); // índice de foto a pantalla completa (Embla → zoom)

  // Compartir la ficha (link + preview con foto y precio) — como Mercado Libre.
  const compartir = async () => {
    const url = `${window.location.origin}/tienda/${p.id}`;
    const texto = `${p.nombre} · ${UYU(p.precio)}${p.cuotas > 0 && cuota > 0 ? ` (${p.cuotas}× ${UYU(cuota)})` : ""} — Tienda Presta Ya`;
    try {
      if (navigator.share) {
        await navigator.share({ title: p.nombre, text: texto, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCompartido(true);
        setTimeout(() => setCompartido(false), 1800);
      }
    } catch { /* el usuario canceló: sin drama */ }
  };

  // (Escape + lock de scroll: los maneja el Drawer de Vaul que envuelve la ficha.)

  const enviar = () =>
    start(async () => {
      setMsg(null);
      if (modoPublico) {
        if (nombre.trim().length < 2) { setEstado("error"); setMsg("Poné tu nombre."); return; }
        if (soloDigitos(tel).length < 6) { setEstado("error"); setMsg("Poné un teléfono/WhatsApp válido."); return; }
        const r = await registrarInteresPublico({ productoId: p.id, productoNombre: p.nombre, nombre: nombre.trim(), telefono: tel.trim() });
        if (r.ok) setEstado("ok"); else { setEstado("error"); setMsg(r.error); }
      } else {
        if (!token) { setEstado("error"); setMsg("Volvé a abrir tu enlace para pedirlo."); return; }
        const r = await registrarInteres({ token, productoId: p.id });
        if (r.ok) setEstado("ok"); else { setEstado("error"); setMsg(r.error); }
      }
    });

  // Compra del EQUIPO: el empleado logueado compra para sí; la cuota se descuenta
  // de su comisión. Idempotente por el nonce de la apertura (opRef).
  const comprar = () =>
    start(async () => {
      setMsg(null);
      if (!opRef.current) opRef.current = crypto.randomUUID(); // nonce estable por compra
      const r = await comprarComoEmpleado({ productoId: p.id, cuotas: cuotasEmp, opId: opRef.current });
      if (r.ok) setEstado("ok");
      else { setEstado("error"); setMsg(r.error); }
    });

  return (
    <>
      {/* Galería (Embla): swipe con momentum + miniaturas + tap→zoom. */}
      <GaleriaEmbla
        fotos={p.fotos}
        videoUrl={p.videoUrl}
        nombre={p.nombre}
        ahorroPct={sinStock ? 0 : ahorroPct}
        esCurbe={p.proveedor === "curbe"}
        onZoom={setZoomIdx}
        onClose={onClose}
      />

        {/* Contenido */}
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1.5">
            {p.proveedor === "curbe" && (
              <a href="https://curbe.uy" target="_blank" rel="noopener noreferrer"
                className="flex w-fit items-center gap-1.5 rounded-full border border-[#E6D3A0] bg-[linear-gradient(135deg,#FBF3DE,#F4E7C3)] px-3 py-1 text-[11.5px] font-black text-[#8A6A16] shadow-sm">
                💎 Pieza de Curbe · curbe.uy →
              </a>
            )}
            {[p.marca, p.categoriaNombre].filter(Boolean).length > 0 && (
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-azul">{[p.marca, p.categoriaNombre].filter(Boolean).join(" · ")}</span>
            )}
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[22px] font-extrabold leading-tight text-tinta">{p.nombre}</h3>
              {!preview && (
                <button type="button" onClick={compartir} aria-label="Compartir producto"
                  className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[#DCE3F4] bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-azul transition hover:bg-suave active:scale-95">
                  {compartido ? "¡Copiado!" : "🔗 Compartir"}
                </button>
              )}
            </div>
          </div>

          {/* Precio + cuotas */}
          <div className="flex flex-col gap-1.5 rounded-[18px] border border-[#E4F0EA] bg-[#F4FBF7] px-4 py-3.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[28px] font-black tabular-nums leading-none text-[#157A50]">{UYU(p.precio)}</span>
              {ahorro > 0 && <span className="text-[15px] font-semibold tabular-nums text-tenue line-through">{UYU(p.precioAnterior)}</span>}
              {ahorro > 0 && <span className="rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[11px] font-black text-[#157A50]">Ahorrás {UYU(ahorro)}</span>}
            </div>
            {p.cuotas > 0 && cuota > 0 && (
              <div className="flex flex-col gap-2 rounded-[12px] bg-white px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <IconoTarjeta className="h-[19px] w-[19px] text-[#1E47C8]" />
                  <span className="text-[14.5px] font-semibold text-cuerpo">
                    <b className="text-[#1E47C8]">{plazoSel} cuotas</b> de <b className="tabular-nums text-[#1E47C8]">{UYU(cuotaSel)}</b> {FREC_LABEL[p.frecuencia]}
                  </span>
                </div>
                {!modoEmpleado && plazos.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-bold text-gris">Elegí el plan:</span>
                    {plazos.map((n) => (
                      <button key={n} type="button" onClick={() => setPlazoSel(n)}
                        className={`rounded-full px-3 py-1 text-[12px] font-bold transition ${plazoSel === n ? "bg-[#1E47C8] text-white" : "border border-[#DCE3F4] bg-white text-cuerpo hover:border-azul"}`}>
                        {n}×
                      </button>
                    ))}
                    <span className="w-full text-[12px] font-medium text-gris">Cuota estimada · el plan final lo confirma tu cobrador.</span>
                  </div>
                )}
              </div>
            )}
            {p.interesPct > 0 && p.cuotas > 0 && (
              <span className="text-[12px] font-medium text-gris">Total en cuotas: <b className="tabular-nums">{UYU(totalCuotas)}</b> ({p.interesPct}% de interés)</span>
            )}
          </div>

          {/* Señales de confianza — le dan sensación de tienda seria. */}
          <div className="grid grid-cols-3 gap-2">
            <TrustItem icon={<IconoCamion className="h-[22px] w-[22px]" />} label="Entrega a domicilio" />
            <TrustItem icon={<IconoEscudo className="h-[22px] w-[22px]" />} label="Con garantía" />
            <TrustItem icon={<IconoCasa className="h-[22px] w-[22px]" />} label="Te lo lleva tu cobrador" />
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
                  <button key={r.id} type="button" onClick={() => { setEstado("idle"); onAbrirOtro(r); }}
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
          {/* Precio + cuota SIEMPRE a la vista junto al CTA (la financiación es el gancho). */}
          {estado !== "ok" && !preview && (
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[20px] font-black tabular-nums leading-none text-[#157A50]">{UYU(p.precio)}</span>
              {p.cuotas > 0 && cuota > 0 && (
                <span className="text-[12.5px] font-bold text-[#1E47C8]">{p.cuotas}× <span className="tabular-nums">{UYU(cuota)}</span> {FREC_LABEL[p.frecuencia]}</span>
              )}
            </div>
          )}
          {preview ? (
            <div className="w-full rounded-full bg-[#EEF3FF] px-5 py-3 text-center text-[14px] font-bold text-azul">Vista previa · así lo ve tu cliente</div>
          ) : estado === "ok" ? (
            <div className="rounded-[14px] bg-[#E4F5EC] px-4 py-2.5 text-center">
              <p className="text-[15px] font-extrabold text-[#157A50]">{modoEmpleado ? "¡Compra registrada! 💚" : "¡Listo! 💚"}</p>
              <p className="text-[12.5px] font-medium text-[#3E8E67]">{modoEmpleado ? "Se irá descontando de tu comisión." : modoPublico ? "Te vamos a contactar para darte los detalles." : "Tu cobrador te va a contar cómo llevártelo."}</p>
            </div>
          ) : sinStock ? (
            <div className="w-full rounded-full bg-[#FBE4E2] px-5 py-3 text-center text-[15px] font-extrabold text-[#C0392B]">Sin stock por ahora 😔</div>
          ) : modoEmpleado ? (
            superaTope ? (
              <div className="rounded-[14px] bg-[#FBE4E2] px-4 py-3 text-center text-[13px] font-bold text-[#C0392B]">
                Supera el tope de compra del equipo ($30.000). Pedísela al administrador.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-bold text-cuerpo">Elegí en cuántas veces pagarlo:</span>
                  <div className="flex gap-1.5">
                    {[1, 3, 6, 12].map((nn) => (
                      <button key={nn} type="button" onClick={() => setCuotasEmp(nn)}
                        className={`flex-1 rounded-[10px] border px-2 py-2 text-[13px] font-bold ${cuotasEmp === nn ? "border-[#1E47C8] bg-[#EEF3FF] text-[#1E47C8]" : "border-[#DCE3F4] bg-white text-cuerpo"}`}>
                        {nn}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-[12px] bg-[#F4FBF7] px-3 py-2 text-center text-[13px] font-semibold text-[#157A50]">
                  {cuotasEmp} cuotas de <b className="tabular-nums">{UYU(cuotaEmp)}</b> · se descuenta de tu comisión
                </div>
                <button type="button" onClick={comprar} disabled={pend}
                  className="w-full rounded-full bg-[#157A50] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(21,122,80,0.28)] active:scale-[0.99] disabled:opacity-60">
                  {pend ? "Registrando…" : "Comprar a crédito"}
                </button>
                {estado === "error" && msg && <p className="text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
                <p className="text-center text-[12px] font-medium text-gris">Compra del equipo · se descuenta de tu comisión al liquidarla.</p>
              </div>
            )
          ) : conCarrito ? (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => { onAgregar?.(p); onClose(); }}
                className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] transition active:scale-[0.99]">
                🛒 Agregar al carrito
              </button>
              <p className="text-center text-[12px] font-medium text-gris">Sumalo al carrito y pedí todo junto. Sin compromiso.</p>
            </div>
          ) : modoPublico && form ? (
            <div className="flex flex-col gap-2">
              <input value={nombre} onChange={(e) => { setNombre(e.target.value); setMsg(null); }} placeholder="Tu nombre" maxLength={80} autoComplete="name"
                className="rounded-[12px] border border-[#DCE3F4] px-3.5 py-2.5 text-[16px] text-tinta outline-none focus:border-azul" autoFocus />
              <input value={tel} onChange={(e) => { setTel(e.target.value); setMsg(null); }} placeholder="Tu teléfono o WhatsApp" type="tel" inputMode="tel" maxLength={30} autoComplete="tel"
                className="rounded-[12px] border border-[#DCE3F4] px-3.5 py-2.5 text-[16px] text-tinta outline-none focus:border-azul" />
              <button type="button" onClick={enviar} disabled={pend}
                className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60">
                {pend ? "Enviando…" : "Enviar mi interés"}
              </button>
              {estado === "error" && msg && <p className="text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
              <p className="text-center text-[12px] font-medium text-gris">Dejanos tu contacto y te escribimos con el precio y las cuotas. Sin compromiso.</p>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => (modoPublico ? setForm(true) : enviar())} disabled={pend}
                className="w-full rounded-full bg-[#1E47C8] px-5 py-3.5 text-[16px] font-extrabold text-white shadow-[0_6px_18px_rgba(19,48,140,0.28)] active:scale-[0.99] disabled:opacity-60">
                {pend ? "Enviando…" : "Me interesa · Quiero saber más"}
              </button>
              {estado === "error" && msg && <p className="mt-1.5 text-center text-[12px] font-semibold text-[#E06A6A]">{msg}</p>}
              <p className="mt-1.5 text-center text-[12px] font-medium text-gris">Sin compromiso. Te contactamos para darte los detalles.</p>
            </>
          )}
        </div>

      {/* Foto a PANTALLA COMPLETA (tap para cerrar) — zoom de la galería. */}
      {zoomIdx != null && p.fotos[zoomIdx] && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomIdx(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.fotos[zoomIdx]} alt={p.nombre} className="max-h-full max-w-full object-contain" />
          <button type="button" onClick={(e) => { e.stopPropagation(); setZoomIdx(null); }} aria-label="Cerrar" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-[16px] font-black text-tinta">✕</button>
          {p.fotos.length > 1 && (
            <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/85 px-3 py-1 text-[12px] font-bold text-tinta">{zoomIdx + 1} / {p.fotos.length}</span>
          )}
        </div>
      )}
    </>
  );
}

function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[12px] border border-[#ECEFF8] bg-[#FBFCFF] px-1.5 py-2.5 text-center">
      <span className="text-azul" aria-hidden>{icon}</span>
      <span className="text-[10.5px] font-bold leading-tight text-cuerpo">{label}</span>
    </div>
  );
}

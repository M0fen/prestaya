"use client";
// Gestión de la TIENDA (admin). Tres solapas: Productos (CRUD + fotos/carrusel +
// video + precio/interés/cuotas + precio POR cliente), Categorías, y Solicitudes
// (los leads que dejan los clientes). Mobile-first, paleta del sitio.
import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UYU } from "@/lib/format";
import { linkWhatsApp, soloDigitos } from "@/lib/telefono";
import { SelectorSegmento } from "@/components/admin/SelectorSegmento";
import {
  guardarProducto, alternarProducto, eliminarProducto,
  guardarCategoria, eliminarCategoria,
  fijarPrecioCliente, quitarPrecioCliente, preciosDeProducto,
  fijarPrecioSegmento, quitarPrecioSegmento, segmentosDeProducto,
  resolverSolicitud, subirImagenTienda, crearUrlSubidaTienda, generarDescripcionIA,
  convertirLeadEnVenta,
  type RawProducto,
} from "@/lib/acciones/tienda";
import { calcularPlanVenta } from "@/lib/venta";
import type {
  Producto, CategoriaProducto, SolicitudProducto, PrecioCliente, PrecioSegmento,
  FrecuenciaProducto, EstadoSolicitud, TipoSegmento,
} from "@/lib/data/tienda";

const FRECUENCIAS: FrecuenciaProducto[] = ["diario", "semanal", "quincenal", "mensual"];
const INPUT = "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[14px] outline-none focus:border-azul";

/** Opción de zona para el dropdown de "precio por segmento". */
export type ZonaOpcion = { id: string; nombre: string };
/** Calificaciones que puede tener un cliente (para el dropdown de segmento). */
const CALIFICACIONES: { valor: string; label: string }[] = [
  { valor: "nuevo", label: "Nuevo" },
  { valor: "excelente", label: "Excelente" },
  { valor: "bueno", label: "Bueno" },
  { valor: "regular", label: "Regular" },
  { valor: "riesgo", label: "Riesgo" },
];

export function TiendaManager({
  productos, categorias, solicitudes, zonas = [], esAdmin = false,
}: {
  productos: Producto[];
  categorias: CategoriaProducto[];
  solicitudes: SolicitudProducto[];
  zonas?: ZonaOpcion[];
  /** Solo el admin puede CONVERTIR un lead en venta (colocar capital). */
  esAdmin?: boolean;
}) {
  const [tab, setTab] = useState<"productos" | "categorias" | "leads">("productos");
  const nuevas = solicitudes.filter((s) => s.estado === "nueva").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Tab activo={tab === "productos"} onClick={() => setTab("productos")}>Productos ({productos.length})</Tab>
        <Tab activo={tab === "categorias"} onClick={() => setTab("categorias")}>Categorías ({categorias.length})</Tab>
        <Tab activo={tab === "leads"} onClick={() => setTab("leads")}>
          Solicitudes{nuevas > 0 ? ` · ${nuevas} nueva${nuevas === 1 ? "" : "s"}` : ""}
        </Tab>
      </div>
      {tab === "productos" && <Productos productos={productos} categorias={categorias} zonas={zonas} />}
      {tab === "categorias" && <Categorias categorias={categorias} />}
      {tab === "leads" && <Leads solicitudes={solicitudes} productos={productos} esAdmin={esAdmin} />}
    </div>
  );
}

function Tab({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold ${activo ? "bg-[#2453DC] text-white" : "bg-[#EEF3FF] text-azul"}`}>
      {children}
    </button>
  );
}

// ── PRODUCTOS ────────────────────────────────────────────────────────────────
const PRODUCTO_VACIO: RawProducto = {
  nombre: "", marca: "", descripcion: "", categoriaId: null, precio: 0, precioAnterior: 0,
  interesPct: 0, cuotas: 0, frecuencia: "diario", fotos: [], videoUrl: null, activo: true, destacado: false, agotado: false, stock: null, orden: 0,
};

function Productos({ productos, categorias, zonas }: { productos: Producto[]; categorias: CategoriaProducto[]; zonas: ZonaOpcion[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<RawProducto | null>(null);
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: Producto) => start(async () => {
    const r = await alternarProducto(p.id, !p.activo);
    if (r.ok) router.refresh(); else setError(r.error);
  });
  const borrar = (p: Producto) => {
    if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
    start(async () => {
      const r = await eliminarProducto(p.id);
      if (r.ok) router.refresh(); else setError(r.error);
    });
  };
  const abrir = (p?: Producto) =>
    setEditando(p ? { ...p, videoUrl: p.videoUrl } : { ...PRODUCTO_VACIO, orden: productos.length });
  // Duplicar: carga el producto en el editor como NUEVO (sin id) → al guardar se crea
  // otro. Comparte fotos con el original (el borrado del Storage es consciente de eso).
  const duplicar = (p: Producto) =>
    setEditando({ ...p, id: undefined, nombre: `${p.nombre} (copia)`, destacado: false, videoUrl: p.videoUrl });

  if (editando) {
    return <EditorProducto raw={editando} categorias={categorias} zonas={zonas} onClose={() => setEditando(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => abrir()}
        className="w-fit rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]">
        + Nuevo producto
      </button>
      {error && <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12.5px] font-semibold text-[#C0392B]">{error}</p>}
      {productos.length === 0 && (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
          Todavía no hay productos. Creá el primero para que aparezca en el cartón de tus clientes.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {productos.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[12px] bg-suave">
              {p.fotos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.fotos[0]} alt={p.nombre} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[28px]">🛍️</div>
              )}
              <div className="absolute left-1.5 top-1.5 flex gap-1">
                {p.destacado && <span className="rounded-full bg-[#FDF0DC] px-2 py-0.5 text-[10px] font-bold text-[#B9770E]">Destacado</span>}
                {(p.agotado || p.stock === 0) && <span className="rounded-full bg-[#FBE4E2] px-2 py-0.5 text-[10px] font-bold text-[#C0392B]">Agotado</span>}
                {!p.agotado && p.stock != null && p.stock > 0 && (
                  <span className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[10px] font-bold text-azul">{p.stock} en stock</span>
                )}
                {!p.activo && <span className="rounded-full bg-[#F1F3F9] px-2 py-0.5 text-[10px] font-bold text-gris">Pausado</span>}
              </div>
              {p.fotos.length > 1 && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
                  {p.fotos.length} fotos
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] font-extrabold text-tinta">{p.nombre}</span>
              <span className="text-[12px] font-medium text-gris">
                {p.categoriaNombre ?? "Sin categoría"} · {UYU(p.precio)}
                {p.interesPct > 0 ? ` · ${p.interesPct}%` : ""}
                {p.cuotas > 0 ? ` · ${p.cuotas} cuotas` : ""}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => abrir(p)} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-azul">Editar</button>
              <button type="button" onClick={() => duplicar(p)} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-gris">Duplicar</button>
              <button type="button" onClick={() => toggle(p)} disabled={pend}
                className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-gris">
                {p.activo ? "Pausar" : "Activar"}
              </button>
              <button type="button" onClick={() => borrar(p)} disabled={pend}
                className="rounded-full border border-[#F3C0B8] bg-white px-3 py-1.5 text-[12px] font-bold text-[#C0392B]">Borrar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorProducto({
  raw, categorias, zonas, onClose,
}: {
  raw: RawProducto;
  categorias: CategoriaProducto[];
  zonas: ZonaOpcion[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<RawProducto>(raw);
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const set = <K extends keyof RawProducto>(k: K, v: RawProducto[K]) => setF((p) => ({ ...p, [k]: v }));

  const [iaLoad, setIaLoad] = useState(false);
  // Descripción con IA: usa nombre + marca + categoría del form. Degrada con aviso.
  const generarIA = async () => {
    setError(null); setIaLoad(true);
    const cat = categorias.find((c) => c.id === f.categoriaId)?.nombre ?? null;
    const r = await generarDescripcionIA({ nombre: f.nombre, marca: f.marca, categoria: cat });
    setIaLoad(false);
    if (r.ok) set("descripcion", r.descripcion);
    else setError(r.error);
  };

  const guardar = () =>
    start(async () => {
      setError(null);
      const res = await guardarProducto(f);
      if (res.ok) { onClose(); router.refresh(); } else setError(res.error);
    });

  const onFotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true); setError(null);
    const nuevas: string[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      const fd = new FormData(); fd.set("file", file);
      const r = await subirImagenTienda(fd);
      if (r.ok) nuevas.push(r.url); else setError(r.error);
    }
    if (nuevas.length) setF((p) => ({ ...p, fotos: [...p.fotos, ...nuevas].slice(0, 10) }));
    setSubiendo(false);
  };

  const onVideo = async (file: File | null) => {
    if (!file) return;
    // Validación de tamaño/tipo ANTES de pedir la URL firmada (la subida es directa
    // al bucket, la Server Action no puede validar el peso). Evita subir un archivo
    // enorme o un no-video al Storage.
    if (!file.type.startsWith("video/")) { setError("Eso no parece un video."); return; }
    if (file.size > 50 * 1024 * 1024) { setError("El video es muy pesado (máx. 50 MB). Recortalo o bajá la calidad."); return; }
    setSubiendo(true); setError(null);
    const pre = await crearUrlSubidaTienda({ nombreArchivo: file.name, contentType: file.type });
    if (!pre.ok) { setError(pre.error); setSubiendo(false); return; }
    try {
      const put = await fetch(pre.signedUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) throw new Error();
      set("videoUrl", pre.publicUrl);
    } catch { setError("No se pudo subir el video. Probá con uno más liviano o pegá la URL."); }
    setSubiendo(false);
  };

  const moverFoto = (i: number, dir: -1 | 1) => {
    setF((p) => {
      const fotos = [...p.fotos]; const j = i + dir;
      if (j < 0 || j >= fotos.length) return p;
      [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
      return { ...p, fotos };
    });
  };
  const quitarFoto = (i: number) => setF((p) => ({ ...p, fotos: p.fotos.filter((_, k) => k !== i) }));
  const hacerPortada = (i: number) => setF((p) => {
    if (i === 0) return p;
    const fotos = [...p.fotos]; const [x] = fotos.splice(i, 1); fotos.unshift(x);
    return { ...p, fotos };
  });

  return (
    <div className="flex flex-col gap-4 rounded-[18px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-extrabold text-tinta">{raw.id ? "Editar producto" : "Nuevo producto"}</h2>
        <button type="button" onClick={onClose} className="text-[13px] font-bold text-gris">← Volver</button>
      </div>

      {/* Fotos (galería / carrusel del producto) */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold uppercase tracking-wide text-gris">Fotos del producto</span>
          <span className="text-[11px] font-semibold text-tenue">{f.fotos.length}/10 · la portada va primero</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {f.fotos.map((url, i) => (
            <div key={url + i} className="relative aspect-square overflow-hidden rounded-[12px] border border-borde bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-contain p-1" />
              {i === 0 ? (
                <span className="absolute left-1 top-1 rounded-full bg-[#2453DC] px-2 py-0.5 text-[9px] font-black text-white">PORTADA</span>
              ) : (
                <button type="button" onClick={() => hacerPortada(i)}
                  className="absolute left-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold text-azul shadow">★ Portada</button>
              )}
              <button type="button" onClick={() => quitarFoto(i)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[11px] font-bold text-white">✕</button>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-1.5 py-0.5">
                <button type="button" onClick={() => moverFoto(i, -1)} disabled={i === 0} className="text-[13px] text-white disabled:opacity-30">◀</button>
                <span className="text-[9px] font-bold text-white/80">#{i + 1}</span>
                <button type="button" onClick={() => moverFoto(i, 1)} disabled={i === f.fotos.length - 1} className="text-[13px] text-white disabled:opacity-30">▶</button>
              </div>
            </div>
          ))}
          {f.fotos.length < 10 && (
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[#C7D2EC] bg-suave text-azul">
              <span className="text-[22px] leading-none">＋</span>
              <span className="text-[11px] font-bold">Subir foto</span>
              <input type="file" accept="image/*" multiple hidden onChange={(e) => onFotos(e.target.files)} />
            </label>
          )}
        </div>
        <span className="text-[11px] font-medium text-tenue">Subí varias (se arma un carrusel). Tocá "★ Portada" para elegir cuál va primero, o ◀▶ para ordenar.</span>
      </section>

      {/* Video */}
      <section className="flex flex-col gap-1.5">
        <span className="text-[12px] font-bold uppercase tracking-wide text-gris">Video (opcional)</span>
        {f.videoUrl && (
          <div className="flex items-center gap-2">
            <video src={f.videoUrl} className="h-16 rounded-[8px]" muted />
            <button type="button" onClick={() => set("videoUrl", null)} className="text-[12px] font-bold text-[#C0392B]">Quitar</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-full border border-dashed border-[#C7D2EC] bg-suave px-3 py-1.5 text-[12px] font-bold text-azul">
            Subir video
            <input type="file" accept="video/*" hidden onChange={(e) => onVideo(e.target.files?.[0] ?? null)} />
          </label>
          <input placeholder="…o pegá una URL de video" defaultValue={f.videoUrl ?? ""}
            onBlur={(e) => set("videoUrl", e.target.value.trim() || null)} className={`${INPUT} flex-1 min-w-[180px]`} />
        </div>
      </section>

      {subiendo && <span className="text-[12px] font-bold text-azul">Subiendo…</span>}

      {/* Datos */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Campo label="Nombre">
          <input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} className={INPUT} placeholder="Ej. Heladera No Frost 300L" />
        </Campo>
        <Campo label="Marca">
          <input value={f.marca ?? ""} onChange={(e) => set("marca", e.target.value)} className={INPUT} placeholder="Ej. Samsung, LG, Whirlpool" />
        </Campo>
        <Campo label="Categoría">
          <select value={f.categoriaId ?? ""} onChange={(e) => set("categoriaId", e.target.value || null)} className={INPUT}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Precio (UYU)">
          <input type="number" inputMode="numeric" value={f.precio || ""} onChange={(e) => set("precio", Math.round(Number(e.target.value) || 0))} className={INPUT} />
        </Campo>
        <Campo label="Precio antes (opcional, para 'oferta')">
          <input type="number" inputMode="numeric" value={f.precioAnterior || ""} onChange={(e) => set("precioAnterior", Math.round(Number(e.target.value) || 0))} className={INPUT} placeholder="mayor al precio actual" />
        </Campo>
        <Campo label="% de interés">
          <input type="number" inputMode="decimal" value={f.interesPct || ""} onChange={(e) => set("interesPct", Number(e.target.value) || 0)} className={INPUT} />
        </Campo>
        <Campo label="Nº de cuotas">
          <input type="number" inputMode="numeric" value={f.cuotas || ""} onChange={(e) => set("cuotas", Math.round(Number(e.target.value) || 0))} className={INPUT} />
        </Campo>
        <Campo label="Frecuencia">
          <select value={f.frecuencia} onChange={(e) => set("frecuencia", e.target.value)} className={INPUT}>
            {FRECUENCIAS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Campo>
        <Campo label="Unidades en stock (vacío = sin control)">
          <input type="number" inputMode="numeric" min={0} value={f.stock ?? ""} placeholder="Ej: 5"
            onChange={(e) => set("stock", e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))}
            className={INPUT} />
        </Campo>
      </div>
      <Campo label="Descripción">
        <div className="flex flex-col gap-1.5">
          <textarea value={f.descripcion ?? ""} onChange={(e) => set("descripcion", e.target.value)} rows={3}
            className={`${INPUT} resize-none`} placeholder="Detalle del producto, medidas, garantía… o generala con IA ✨" />
          <button type="button" onClick={generarIA} disabled={iaLoad || !(f.nombre ?? "").trim()}
            className="w-fit rounded-full border border-[#C7D2EC] bg-azul-suave px-3 py-1.5 text-[12px] font-bold text-azul active:scale-95 disabled:opacity-40">
            {iaLoad ? "Generando…" : "✨ Generar con IA"}
          </button>
        </div>
      </Campo>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-cuerpo">
          <input type="checkbox" checked={f.activo} onChange={(e) => set("activo", e.target.checked)} /> Visible en la tienda
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-cuerpo">
          <input type="checkbox" checked={f.destacado} onChange={(e) => set("destacado", e.target.checked)} /> Destacar como banner
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-cuerpo">
          <input type="checkbox" checked={Boolean(f.agotado)} onChange={(e) => set("agotado", e.target.checked)} /> Agotado (sin stock)
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-cuerpo">
          Orden <input type="number" value={f.orden} onChange={(e) => set("orden", Math.round(Number(e.target.value) || 0))} className={`${INPUT} w-20`} />
        </label>
      </div>
      <p className="text-[11.5px] font-medium text-gris">
        El destacado aparece en la fila “⭐ Destacados” de la tienda; el <b>primero</b> (menor “Orden”) también sale como <b>banner en la cuenta del cliente</b> con “Ver más detalle”.
      </p>

      {/* Visibilidad por audiencia (0089): quién VE el producto. Sin "estado del
          crédito" (la tienda no calcula el cartón) → por calificación / zona. */}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-cuerpo">¿Quién lo ve?</span>
        <SelectorSegmento
          value={f.segmentoDef ?? null}
          onChange={(d) => set("segmentoDef", d)}
          zonas={zonas}
          sinEstado
        />
      </div>

      {error && <span className="text-[12.5px] font-semibold text-[#C0392B]">{error}</span>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={pend} className="rounded-full border border-borde bg-tarjeta px-4 py-2.5 text-[13px] font-bold text-gris">Cancelar</button>
        <button type="button" onClick={guardar} disabled={pend || subiendo}
          className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50">
          {pend ? "Guardando…" : "Guardar producto"}
        </button>
      </div>

      {/* Precios especiales (solo al editar un producto ya creado) */}
      {raw.id && (
        <>
          <PrecioPorSegmento productoId={raw.id} zonas={zonas} />
          <PrecioPorCliente productoId={raw.id} />
        </>
      )}
    </div>
  );
}

function PrecioPorSegmento({ productoId, zonas }: { productoId: string; zonas: ZonaOpcion[] }) {
  const router = useRouter();
  const [lista, setLista] = useState<PrecioSegmento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tipo, setTipo] = useState<TipoSegmento>("calificacion");
  const [valor, setValor] = useState("");
  const [precio, setPrecio] = useState("");
  const [interes, setInteres] = useState("");
  const [cuotas, setCuotas] = useState("");
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const recargar = () => segmentosDeProducto(productoId).then((r) => { if (r.ok) setLista(r.segmentos); setCargando(false); });
  useEffect(() => { recargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productoId]);

  // Etiqueta legible de una regla (para la lista): "Calificación · Excelente" / "Zona · Centro".
  const nombreZona = (id: string) => zonas.find((z) => z.id === id)?.nombre ?? "Zona";
  const etiqueta = (s: PrecioSegmento) =>
    s.tipo === "zona" ? `Zona · ${nombreZona(s.valor)}`
    : `Calificación · ${CALIFICACIONES.find((c) => c.valor === s.valor)?.label ?? s.valor}`;

  const opciones = tipo === "zona" ? zonas.map((z) => ({ valor: z.id, label: z.nombre })) : CALIFICACIONES;

  const agregar = () => {
    if (!valor) { setError("Elegí a quién aplica (calificación o zona)."); return; }
    if (!(Number(precio) > 0)) { setError("Poné un precio mayor a 0."); return; }
    start(async () => {
      setError(null);
      const res = await fijarPrecioSegmento({
        productoId, tipo, valor, precio: Number(precio),
        interesPct: Number(interes) || 0, cuotas: Number(cuotas) || 0,
      });
      if (res.ok) { setValor(""); setPrecio(""); setInteres(""); setCuotas(""); recargar(); router.refresh(); }
      else setError(res.error);
    });
  };
  const quitar = (id: string) => start(async () => { await quitarPrecioSegmento(id); recargar(); router.refresh(); });

  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-[#E6EAF4] bg-suave p-3.5">
      <span className="text-[13px] font-extrabold text-tinta">Precio especial por segmento</span>
      <span className="text-[11.5px] font-medium text-gris">
        Fijá otro precio/interés/cuotas para todo un grupo (por calificación o por zona). Prioridad: un precio por cliente puntual gana sobre el de zona, y el de zona sobre el de calificación.
      </span>

      {cargando ? <span className="text-[12px] text-gris">Cargando…</span> : lista.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {lista.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-[10px] border border-borde bg-tarjeta px-3 py-2">
              <span className="text-[12.5px] font-semibold text-tinta">{etiqueta(s)}</span>
              <span className="flex items-center gap-2 text-[12px] font-medium text-gris">
                {UYU(s.precio)}{s.interesPct > 0 ? ` · ${s.interesPct}%` : ""}{s.cuotas > 0 ? ` · ${s.cuotas}c` : ""}
                <button type="button" onClick={() => quitar(s.id)} disabled={pend} className="font-bold text-[#C0392B]">✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-borde bg-tarjeta p-2.5">
        <label className="flex flex-col gap-1 text-[11px] font-bold text-gris uppercase">
          Segmentar por
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoSegmento); setValor(""); }} className={`${INPUT} w-32`}>
            <option value="calificacion">Calificación</option>
            <option value="zona">Zona</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-gris uppercase">
          {tipo === "zona" ? "Zona" : "Calificación"}
          <select value={valor} onChange={(e) => setValor(e.target.value)} className={`${INPUT} w-40`}>
            <option value="">Elegí…</option>
            {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </label>
        <input type="number" placeholder="Precio" value={precio} onChange={(e) => setPrecio(e.target.value)} className={`${INPUT} w-24`} />
        <input type="number" placeholder="% int." value={interes} onChange={(e) => setInteres(e.target.value)} className={`${INPUT} w-20`} />
        <input type="number" placeholder="Cuotas" value={cuotas} onChange={(e) => setCuotas(e.target.value)} className={`${INPUT} w-20`} />
        <button type="button" onClick={agregar} disabled={pend} className="rounded-full bg-[#2453DC] px-3 py-2 text-[12px] font-bold text-white">Fijar</button>
      </div>
      {tipo === "zona" && zonas.length === 0 && (
        <span className="text-[11px] font-medium text-gris">No hay zonas cargadas todavía. Creá zonas en Configuración → Zonas.</span>
      )}
      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </section>
  );
}

function PrecioPorCliente({ productoId }: { productoId: string }) {
  const router = useRouter();
  const [lista, setLista] = useState<PrecioCliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<{ id: string; nombre: string }[]>([]);
  const [sel, setSel] = useState<{ id: string; nombre: string } | null>(null);
  const [precio, setPrecio] = useState("");
  const [interes, setInteres] = useState("");
  const [cuotas, setCuotas] = useState("");
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const buscarRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargar = () => preciosDeProducto(productoId).then((r) => { if (r.ok) setLista(r.precios); setCargando(false); });
  useEffect(() => { recargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productoId]);

  const buscar = (t: string) => {
    setQ(t); setSel(null);
    if (buscarRef.current) clearTimeout(buscarRef.current);
    if (t.trim().length < 2) { setResultados([]); return; }
    buscarRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar-clientes?q=${encodeURIComponent(t.trim())}`);
        const j = await r.json();
        setResultados(j.clientes ?? []);
      } catch { setResultados([]); }
    }, 250);
  };

  const agregar = () => {
    if (!sel || !(Number(precio) > 0)) { setError("Elegí un cliente y poné un precio."); return; }
    start(async () => {
      setError(null);
      const res = await fijarPrecioCliente({
        productoId, clienteId: sel.id, precio: Number(precio),
        interesPct: Number(interes) || 0, cuotas: Number(cuotas) || 0,
      });
      if (res.ok) { setSel(null); setQ(""); setPrecio(""); setInteres(""); setCuotas(""); setResultados([]); recargar(); router.refresh(); }
      else setError(res.error);
    });
  };
  const quitar = (id: string) => start(async () => { await quitarPrecioCliente(id); recargar(); router.refresh(); });

  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-[#E6EAF4] bg-suave p-3.5">
      <span className="text-[13px] font-extrabold text-tinta">Precio especial por cliente</span>
      <span className="text-[11.5px] font-medium text-gris">Fijá otro precio/interés/cuotas para un cliente puntual. Le aparece a él en su cartón.</span>

      {cargando ? <span className="text-[12px] text-gris">Cargando…</span> : lista.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {lista.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-[10px] border border-borde bg-tarjeta px-3 py-2">
              <span className="text-[12.5px] font-semibold text-tinta">{p.clienteNombre}</span>
              <span className="flex items-center gap-2 text-[12px] font-medium text-gris">
                {UYU(p.precio)}{p.interesPct > 0 ? ` · ${p.interesPct}%` : ""}{p.cuotas > 0 ? ` · ${p.cuotas}c` : ""}
                <button type="button" onClick={() => quitar(p.id)} disabled={pend} className="font-bold text-[#C0392B]">✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[10px] border border-borde bg-tarjeta p-2.5">
        <div className="relative">
          <input value={q} onChange={(e) => buscar(e.target.value)} placeholder="Buscar cliente por nombre…" className={`${INPUT} w-full`} />
          {resultados.length > 0 && !sel && (
            <div className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-[10px] border border-borde bg-tarjeta shadow-lg">
              {resultados.map((c) => (
                <button key={c.id} type="button" onClick={() => { setSel(c); setQ(c.nombre); setResultados([]); }}
                  className="block w-full px-3 py-2 text-left text-[13px] hover:bg-suave">{c.nombre}</button>
              ))}
            </div>
          )}
        </div>
        {sel && (
          <div className="flex flex-wrap items-end gap-2">
            <span className="rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[12px] font-bold text-azul">{sel.nombre}</span>
            <input type="number" placeholder="Precio" value={precio} onChange={(e) => setPrecio(e.target.value)} className={`${INPUT} w-24`} />
            <input type="number" placeholder="% int." value={interes} onChange={(e) => setInteres(e.target.value)} className={`${INPUT} w-20`} />
            <input type="number" placeholder="Cuotas" value={cuotas} onChange={(e) => setCuotas(e.target.value)} className={`${INPUT} w-20`} />
            <button type="button" onClick={agregar} disabled={pend} className="rounded-full bg-[#2453DC] px-3 py-2 text-[12px] font-bold text-white">Fijar</button>
          </div>
        )}
        {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
      </div>
    </section>
  );
}

// ── CATEGORÍAS ─────────────────────────────────────────────────────────────
function Categorias({ categorias }: { categorias: CategoriaProducto[] }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const correr = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, luego?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { luego?.(); router.refresh(); } else setError(r.error);
    });
  const crear = () => {
    if (!nombre.trim()) return;
    correr(() => guardarCategoria({ nombre: nombre.trim(), orden: categorias.length, activo: true }), () => setNombre(""));
  };
  const toggle = (c: CategoriaProducto) => correr(() => guardarCategoria({ id: c.id, nombre: c.nombre, orden: c.orden, activo: !c.activo }));
  const borrar = (c: CategoriaProducto) => { if (confirm(`¿Borrar la categoría "${c.nombre}"? Los productos quedan sin categoría.`)) correr(() => eliminarCategoria(c.id)); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nueva categoría (ej. Electrodomésticos)" className={`${INPUT} flex-1`} />
        <button type="button" onClick={crear} disabled={pend} className="rounded-full bg-[#2453DC] px-4 py-2 text-[13px] font-bold text-white">Agregar</button>
      </div>
      {error && <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12.5px] font-semibold text-[#C0392B]">{error}</p>}
      <div className="flex flex-col gap-1.5">
        {categorias.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-[12px] border border-borde bg-tarjeta px-3.5 py-2.5">
            <span className="text-[13.5px] font-semibold text-tinta">{c.nombre}{!c.activo && <span className="ml-2 text-[11px] font-bold text-gris">(oculta)</span>}</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => toggle(c)} disabled={pend} className="rounded-full border border-borde px-3 py-1 text-[12px] font-bold text-gris">{c.activo ? "Ocultar" : "Mostrar"}</button>
              <button type="button" onClick={() => borrar(c)} disabled={pend} className="rounded-full border border-[#F3C0B8] px-3 py-1 text-[12px] font-bold text-[#C0392B]">Borrar</button>
            </div>
          </div>
        ))}
        {categorias.length === 0 && <p className="text-[13px] font-medium text-gris">Sin categorías todavía.</p>}
      </div>
    </div>
  );
}

// ── SOLICITUDES / LEADS ──────────────────────────────────────────────────────
const ESTADO_TONO: Record<EstadoSolicitud, { bg: string; fg: string; label: string }> = {
  nueva: { bg: "#FDF0DC", fg: "#B9770E", label: "Nueva" },
  contactado: { bg: "#EEF3FF", fg: "#1E47C8", label: "Contactado" },
  cerrada: { bg: "#E4F5EC", fg: "#157A50", label: "Cerrada" },
  descartada: { bg: "#F1F3F9", fg: "#6B7494", label: "Descartada" },
  convertida: { bg: "#E7ECFF", fg: "#13308C", label: "🛒 Vendido" },
};

function Leads({ solicitudes, productos, esAdmin }: { solicitudes: SolicitudProducto[]; productos: Producto[]; esAdmin: boolean }) {
  const total = solicitudes.length;
  const cont = (e: EstadoSolicitud) => solicitudes.filter((s) => s.estado === e).length;
  // "Más pedidos": ranking de productos por cantidad de leads.
  const topProd = (() => {
    const m = new Map<string, number>();
    for (const s of solicitudes) m.set(s.productoNombre, (m.get(s.productoNombre) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  })();

  if (total === 0) {
    return <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">Sin solicitudes todavía. Cuando un cliente toque "Me interesa", aparece acá.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {/* Métricas de interés (sobre lo cargado) */}
      <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[13px] font-extrabold text-tinta">Resumen de interés</span>
        <div className="grid grid-cols-4 gap-2">
          <MiniLead k="Total" v={total} />
          <MiniLead k="Nuevos" v={cont("nueva")} tono="ambar" />
          <MiniLead k="Atendidos" v={cont("contactado") + cont("cerrada")} tono="verde" />
          <MiniLead k="Descartados" v={cont("descartada")} />
        </div>
        {topProd.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Más pedidos</span>
            <div className="flex flex-wrap gap-1.5">
              {topProd.map(([nombre, n]) => (
                <span key={nombre} className="rounded-full bg-suave px-2.5 py-0.5 text-[11.5px] font-semibold text-cuerpo">
                  {nombre} · <b className="tabular-nums">{n}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {solicitudes.map((s) => (
          <LeadCard key={s.id} s={s} producto={productos.find((p) => p.id === s.productoId)} esAdmin={esAdmin} />
        ))}
      </div>
    </div>
  );
}

function MiniLead({ k, v, tono }: { k: string; v: number; tono?: "ambar" | "verde" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-suave p-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</span>
      <span className={`text-[17px] font-extrabold tabular-nums ${tono === "verde" ? "text-verde" : tono === "ambar" ? "text-ambar-osc" : "text-tinta"}`}>{v}</span>
    </div>
  );
}

function LeadCard({ s, producto, esAdmin }: { s: SolicitudProducto; producto?: Producto; esAdmin: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [nota, setNota] = useState(s.nota ?? "");
  const [editaNota, setEditaNota] = useState(false);
  const [ventaAbierta, setVentaAbierta] = useState(false);
  const [plazo, setPlazo] = useState<number>(producto?.cuotas || 20);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaProducto>(producto?.frecuencia ?? "diario");
  const [msgVenta, setMsgVenta] = useState<string | null>(null);
  const abierto = s.estado === "nueva" || s.estado === "contactado";
  const puedeVender = esAdmin && abierto && !!producto;
  // Preview del plan con el PRECIO BASE del producto (el precio real del cliente
  // —si tiene uno especial— se resuelve en el SERVIDOR al confirmar; esto es guía).
  const planPreview = producto ? calcularPlanVenta({ precio: producto.precio, interesPct: producto.interesPct, cuotas: plazo }) : null;
  const venderAhora = () =>
    start(async () => {
      setMsgVenta(null);
      const r = await convertirLeadEnVenta({ solicitudId: s.id, plazo, frecuencia });
      if (r.ok) {
        setMsgVenta(
          r.yaConvertido
            ? "Este pedido ya estaba vendido."
            : `¡Venta creada! Cuota ${UYU(r.cuota)}${r.sinCobrador ? " · ⚠️ el cliente no tiene cobrador asignado (asignale uno para que entre a la ruta)" : ""}`,
        );
        router.refresh();
      } else {
        setMsgVenta(r.error);
      }
    });
  const t = ESTADO_TONO[s.estado];
  const tel = soloDigitos(s.clienteTelefono);
  const wa = s.clienteTelefono
    ? linkWhatsApp(s.clienteTelefono, `Hola ${s.clienteNombre}, vimos que te interesó ${s.productoNombre} 🙂`)
    : null;
  // Al marcar un estado, se adjunta la nota actual (para no perderla).
  const marcar = (estado: EstadoSolicitud) =>
    start(async () => { await resolverSolicitud(s.id, estado, nota.trim() || null); router.refresh(); });
  const guardarNota = () =>
    start(async () => { await resolverSolicitud(s.id, s.estado, nota.trim() || null); setEditaNota(false); router.refresh(); });

  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/admin/clientes/${s.clienteId}`} className="truncate text-[14px] font-extrabold text-azul hover:underline">
          {s.clienteNombre}
        </Link>
        <span className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
      </div>
      <span className="text-[12.5px] font-medium text-gris">Interesado en: <b className="text-cuerpo">{s.productoNombre}</b></span>
      <span className="text-[11px] font-medium text-tenue">
        {new Date(s.creadoEn).toLocaleString("es-UY", { timeZone: "America/Montevideo" })}
        {s.resueltoPorNombre && ` · resuelto por ${s.resueltoPorNombre}`}
      </span>

      {/* Nota del lead (ver + editar) */}
      {editaNota ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={200}
            placeholder="Ej: quedó de pasar el viernes; ofrecerle 12 cuotas."
            className="rounded-[10px] border border-campo bg-tarjeta px-2.5 py-1.5 text-[12.5px] text-tinta outline-none focus:border-azul"
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={guardarNota} disabled={pend}
              className="rounded-full bg-azul px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">Guardar nota</button>
            <button type="button" onClick={() => { setNota(s.nota ?? ""); setEditaNota(false); }}
              className="rounded-full border border-campo px-3 py-1 text-[12px] font-bold text-gris">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditaNota(true)}
          className="flex items-start gap-1.5 rounded-[10px] bg-suave px-2.5 py-1.5 text-left text-[12px] font-medium text-cuerpo">
          <span>📝</span>
          <span className={s.nota ? "" : "text-tenue"}>{s.nota || "Agregar una nota…"}</span>
        </button>
      )}

      {/* Contacto directo */}
      {s.clienteTelefono ? (
        <div className="flex flex-wrap gap-1.5">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-3 py-1 text-[12px] font-extrabold text-white active:scale-95">
              💬 WhatsApp
            </a>
          )}
          <a href={`tel:${tel}`}
            className="inline-flex items-center gap-1 rounded-full border border-campo px-3 py-1 text-[12px] font-bold text-cuerpo">
            📞 {s.clienteTelefono}
          </a>
        </div>
      ) : (
        <span className="text-[11px] font-medium text-tenue-2">Sin teléfono cargado · abrí la ficha del cliente</span>
      )}

      {/* Convertir el pedido en una VENTA real (crédito). Solo admin, pedido abierto. */}
      {s.estado === "convertida" ? (
        <Link href={`/admin/clientes/${s.clienteId}`}
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#E7ECFF] px-3 py-1.5 text-[12px] font-bold text-[#13308C] hover:underline">
          🛒 Vendido · ver el crédito en la ficha →
        </Link>
      ) : puedeVender ? (
        <div className="mt-1 border-t border-linea pt-2">
          {!ventaAbierta ? (
            <button type="button" onClick={() => setVentaAbierta(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1E47C8] px-3.5 py-1.5 text-[12.5px] font-extrabold text-white active:scale-95">
              🛒 Convertir en venta
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-[12px] border border-[#C7D2EC] bg-azul-suave p-3">
              <span className="text-[12.5px] font-extrabold text-[#13308C]">Crear el crédito de venta · {s.productoNombre}</span>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] font-bold text-gris">Cuotas</span>
                  <input type="number" min={1} max={1000} value={plazo}
                    onChange={(e) => setPlazo(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                    className="w-20 rounded-[8px] border border-campo bg-tarjeta px-2 py-1 text-[13px] tabular-nums outline-none focus:border-azul" />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] font-bold text-gris">Frecuencia</span>
                  <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaProducto)}
                    className="rounded-[8px] border border-campo bg-tarjeta px-2 py-1 text-[13px] outline-none focus:border-azul">
                    {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
              {planPreview && (
                <p className="text-[12px] font-medium text-cuerpo">
                  ≈ <b className="tabular-nums">{UYU(planPreview.cuota)}</b>/{frecuencia === "diario" ? "día" : "cuota"} · total a cobrar <b className="tabular-nums">{UYU(planPreview.totalACobrar)}</b>
                  <span className="mt-0.5 block text-[10.5px] text-tenue">Precio base; si el cliente tiene precio especial, se aplica al confirmar.</span>
                </p>
              )}
              <div className="flex gap-1.5">
                <button type="button" onClick={venderAhora} disabled={pend}
                  className="rounded-full bg-[#1FA971] px-3.5 py-1.5 text-[12.5px] font-extrabold text-white disabled:opacity-50">
                  {pend ? "Creando…" : "Confirmar venta"}
                </button>
                <button type="button" onClick={() => { setVentaAbierta(false); setMsgVenta(null); }}
                  className="rounded-full border border-campo px-3 py-1.5 text-[12.5px] font-bold text-gris">Cancelar</button>
              </div>
            </div>
          )}
          {msgVenta && <p className="mt-1.5 text-[12px] font-semibold text-cuerpo">{msgVenta}</p>}
        </div>
      ) : esAdmin && abierto && !producto ? (
        <span className="mt-1 text-[11px] font-medium text-tenue-2">El producto de este pedido ya no existe (no se puede vender).</span>
      ) : null}

      {s.estado !== "convertida" && (
        <div className="mt-1 flex flex-wrap gap-1.5 border-t border-linea pt-2">
          {(["contactado", "cerrada", "descartada"] as EstadoSolicitud[]).map((e) => (
            <button key={e} type="button" onClick={() => marcar(e)} disabled={pend || s.estado === e}
              className="rounded-full border border-borde bg-tarjeta px-3 py-1 text-[12px] font-bold text-gris disabled:opacity-40">
              {ESTADO_TONO[e].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-gris">{label}</span>
      {children}
    </label>
  );
}

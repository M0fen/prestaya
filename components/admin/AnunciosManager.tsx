"use client";
// Gestión de anuncios / publicidad de temporada (admin). Crear/editar, activar,
// programar por fechas, segmentar y priorizar SIN tocar código. Incluye una
// VISTA PREVIA en vivo de cómo se verá en la pantalla del cliente.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Anuncio, TemaAnuncio, SegmentoAnuncio } from "@/types/db";
import { BannerCarrusel } from "@/components/BannerCarrusel";
import { guardarAnuncio, alternarAnuncio, eliminarAnuncio, subirImagenAnuncio, type RawAnuncio } from "@/lib/acciones/anuncios";
import { estadoPublicacion, META_ESTADO } from "@/lib/publicacion";
import { EstadoBadge } from "@/components/admin/EstadoBadge";
import { SelectorSegmento } from "@/components/admin/SelectorSegmento";
import { describirSegmento } from "@/lib/segmentos";
import { esAvisoCurbe } from "@/lib/curbe";

const TEMAS: { v: TemaAnuncio; label: string }[] = [
  { v: "azul", label: "Azul" },
  { v: "verde", label: "Verde" },
  { v: "ambar", label: "Ámbar" },
  { v: "oscuro", label: "Oscuro" },
  { v: "dorado", label: "Dorado (publicidad)" },
];
const vacio: RawAnuncio = {
  id: null, titulo: "", cuerpo: "", ctaTexto: "", ctaUrl: "", imagenUrl: "", etiqueta: "",
  tema: "azul", prioridad: 0, activo: true, segmento: "todos", fechaInicio: "", fechaFin: "",
};

/** Plantillas de arranque: prellenan el formulario con un tono ya listo (framing
 *  positivo, voseo). El admin edita desde ahí en vez de la hoja en blanco. */
const PLANTILLAS: { nombre: string; datos: Partial<RawAnuncio> }[] = [
  { nombre: "📣 Promo", datos: { etiqueta: "Promoción", titulo: "¡Aprovechá esta semana!", cuerpo: "Tenemos un beneficio especial para vos.", tema: "verde", ctaTexto: "Ver más" } },
  { nombre: "💙 Recordatorio", datos: { etiqueta: "Recordatorio", titulo: "Un pasito más hacia tu meta", cuerpo: "Cada pago te acerca. ¡Vas muy bien!", tema: "azul" } },
  { nombre: "🎉 Novedad", datos: { etiqueta: "Novedad", titulo: "Tenemos algo nuevo para vos", cuerpo: "", tema: "azul" } },
  { nombre: "🏷️ Publicidad", datos: { etiqueta: "Publicidad", titulo: "Título de la publicidad", cuerpo: "", tema: "dorado", ctaTexto: "Ver oferta" } },
];

/** Fecha corta local ("DD/MM"). "" si es vacía/ilegible. */
function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Ventana de fechas legible para la fila: "Siempre" / "Hasta 31/07" / "Desde 01/08" / "01/08–31/08". */
function ventanaCorta(desde: string | null, hasta: string | null): string {
  const d = fechaCorta(desde);
  const h = fechaCorta(hasta);
  if (!d && !h) return "Siempre";
  if (d && h) return `${d}–${h}`;
  if (h) return `Hasta ${h}`;
  return `Desde ${d}`;
}

/** ISO → valor para <input datetime-local> ("YYYY-MM-DDTHH:mm"). */
function aLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AnunciosManager({
  anuncios,
  zonas = [],
}: {
  anuncios: Anuncio[];
  /** Zonas disponibles para el targeting por zona (inyectadas desde la página). */
  zonas?: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<RawAnuncio>(vacio);
  const [ocupado, setOcupado] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof RawAnuncio>(k: K, v: RawAnuncio[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const subirImagen = async (file: File | null) => {
    if (!file) return;
    setSubiendo(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const r = await subirImagenAnuncio(fd);
    setSubiendo(false);
    if (r.ok) set("imagenUrl", r.url);
    else setError(r.error);
  };

  const editar = (a: Anuncio) =>
    setForm({
      id: a.id, titulo: a.titulo, cuerpo: a.cuerpo ?? "", ctaTexto: a.cta_texto ?? "",
      ctaUrl: a.cta_url ?? "", imagenUrl: a.imagen_url ?? "", etiqueta: a.etiqueta ?? "", tema: a.tema,
      prioridad: a.prioridad, activo: a.activo, segmento: a.segmento, segmentoDef: a.segmento_def,
      fechaInicio: aLocal(a.fecha_inicio), fechaFin: aLocal(a.fecha_fin),
    });

  // Duplicar: carga el formulario con los datos del anuncio pero SIN id (crea uno
  // nuevo) y sin fechas (para relanzar una campaña de temporada sin retipear todo).
  const duplicar = (a: Anuncio) => {
    setForm({
      id: null, titulo: a.titulo, cuerpo: a.cuerpo ?? "", ctaTexto: a.cta_texto ?? "",
      ctaUrl: a.cta_url ?? "", imagenUrl: a.imagen_url ?? "", etiqueta: a.etiqueta ?? "", tema: a.tema,
      prioridad: a.prioridad, activo: true, segmento: a.segmento, segmentoDef: a.segmento_def, fechaInicio: "", fechaFin: "",
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const guardar = async () => {
    setOcupado(true);
    setError("");
    const r = await guardarAnuncio(form);
    setOcupado(false);
    if (r.ok) {
      setForm(vacio);
      router.refresh();
    } else setError(r.error);
  };

  const toggle = async (a: Anuncio) => {
    await alternarAnuncio(a.id, !a.activo);
    router.refresh();
  };
  const borrar = async (a: Anuncio) => {
    // Curbe se siembra por script (IDs fijos): si se borra, "reaparece" al
    // re-sembrar. Avisamos y sugerimos pausar en vez de borrar.
    const msg = esAvisoCurbe(a.id)
      ? "Este es el aviso de curbe (publicidad gestionada por fuera). Si lo borrás, va a volver a aparecer la próxima vez que se sincronice. Mejor usá “Pausar”. ¿Borrar igual?"
      : `¿Borrar el anuncio "${a.titulo}"?`;
    if (!confirm(msg)) return;
    await eliminarAnuncio(a.id);
    if (form.id === a.id) setForm(vacio);
    router.refresh();
  };

  // Anuncio sintético para la vista previa (a partir del formulario).
  const preview: Anuncio = {
    id: "preview", titulo: form.titulo || "Título del anuncio",
    cuerpo: form.cuerpo || null, cta_texto: form.ctaTexto || null, cta_url: form.ctaUrl || null,
    imagen_url: form.imagenUrl || null, etiqueta: form.etiqueta || null,
    tema: form.tema as TemaAnuncio, prioridad: form.prioridad,
    activo: form.activo, segmento: form.segmento as SegmentoAnuncio, segmento_def: form.segmentoDef ?? null,
    // Usa las fechas REALES del formulario (antes hardcodeaba "ahora/sin fin" → el
    // preview mentía sobre la vigencia).
    fecha_inicio: form.fechaInicio ? new Date(form.fechaInicio).toISOString() : new Date().toISOString(),
    fecha_fin: form.fechaFin ? new Date(form.fechaFin).toISOString() : null,
    creado_por: null,
    creado_en: "", actualizado_en: "",
  };
  // Estado de publicación EN VIVO del formulario: si quedó pausado o programado, el
  // admin lo ve acá aunque el banner igual se dibuje (deja de "creer que publicó").
  const estadoForm = estadoPublicacion({ activo: form.activo, desde: preview.fecha_inicio, hasta: preview.fecha_fin });

  const inputCls =
    "w-full rounded-[12px] border border-borde px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul";

  return (
    <div className="flex flex-col gap-5">
      {/* Formulario + preview */}
      <div className="rounded-[18px] border border-borde bg-tarjeta p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-extrabold text-tinta">
            {form.id ? "Editar anuncio" : "Nuevo anuncio"}
          </span>
          {form.id && (
            <button onClick={() => setForm(vacio)} className="text-[12px] font-bold text-gris">
              + Nuevo
            </button>
          )}
        </div>

        {/* Plantillas para arrancar (solo al crear uno nuevo). */}
        {!form.id && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wide text-gris">Empezá con…</span>
            {PLANTILLAS.map((p) => (
              <button
                key={p.nombre}
                type="button"
                onClick={() => setForm({ ...vacio, ...p.datos })}
                className="rounded-full border border-borde bg-suave px-3 py-1 text-[12px] font-bold text-cuerpo hover:bg-tarjeta"
              >
                {p.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Vista previa en vivo (cómo lo ve el cliente) + estado real de publicación. */}
        <div className="mb-4 rounded-[16px] bg-[#EAEEF7] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold tracking-wide text-gris uppercase">Vista previa</span>
            <EstadoBadge estado={estadoForm} />
          </div>
          <div className="mx-auto max-w-[380px]">
            <BannerCarrusel anuncios={[preview]} />
          </div>
          {estadoForm !== "en_pantalla" && (
            <p className="mt-2 text-[11px] font-semibold text-[#B9770E]">
              Ojo: así no se le muestra al cliente todavía ({META_ESTADO[estadoForm].label.toLowerCase()}).
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <input className={inputCls} placeholder="Título *" maxLength={80}
            value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />
          <textarea className={`${inputCls} min-h-[60px]`} placeholder="Cuerpo (opcional)" maxLength={240}
            value={form.cuerpo ?? ""} onChange={(e) => set("cuerpo", e.target.value)} />
          <input className={inputCls} maxLength={24}
            placeholder='Etiqueta arriba (por defecto "Novedad" · para publicidad: "Publicidad")'
            value={form.etiqueta ?? ""} onChange={(e) => set("etiqueta", e.target.value)} />
          <div className="grid grid-cols-2 gap-2.5">
            <input className={inputCls} placeholder="Texto del botón (opcional)" maxLength={40}
              value={form.ctaTexto ?? ""} onChange={(e) => set("ctaTexto", e.target.value)} />
            <input className={inputCls} placeholder="Link del botón (https://…)"
              value={form.ctaUrl ?? ""} onChange={(e) => set("ctaUrl", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <input className={`${inputCls} min-w-0 flex-1`} placeholder="URL de imagen (opcional) o subí una →"
                value={form.imagenUrl ?? ""} onChange={(e) => set("imagenUrl", e.target.value)} />
              <label className={`flex-shrink-0 cursor-pointer rounded-[12px] border border-borde px-3 py-2 text-[12.5px] font-bold text-azul hover:bg-suave ${subiendo ? "opacity-50" : ""}`}>
                {subiendo ? "Subiendo…" : "📷 Subir"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  disabled={subiendo}
                  onChange={(e) => { subirImagen(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              </label>
            </div>
            {form.imagenUrl && (
              <button type="button" onClick={() => set("imagenUrl", "")}
                className="w-fit text-[11px] font-semibold text-gris hover:text-[#D64545]">
                Quitar imagen
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-gris">
              Color
              <select className={inputCls} value={form.tema} onChange={(e) => set("tema", e.target.value)}>
                {TEMAS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
          </div>

          {/* Audiencia (0089): a QUÉ RANGO DE PERSONAS le aparece. Reemplaza el viejo
              "A quién" de 3 opciones por targeting por calificación / estado / zona. */}
          <SelectorSegmento
            value={form.segmentoDef ?? null}
            onChange={(d) => set("segmentoDef", d)}
            zonas={zonas}
          />

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-gris">
              Desde (opcional)
              <input type="datetime-local" className={inputCls}
                value={form.fechaInicio ?? ""} onChange={(e) => set("fechaInicio", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-gris">
              Hasta (opcional)
              <input type="datetime-local" className={inputCls}
                value={form.fechaFin ?? ""} onChange={(e) => set("fechaFin", e.target.value)} />
            </label>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-gris">
              Prioridad
              <input type="number" min={0} max={999} className={`${inputCls} w-24`}
                value={form.prioridad} onChange={(e) => set("prioridad", Number(e.target.value))} />
            </label>
            <label className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-tinta">
              <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
              Activo
            </label>
          </div>

          {error && <p className="text-[12px] font-semibold text-[#D64545]">{error}</p>}

          <button onClick={guardar} disabled={ocupado}
            className="mt-1 rounded-full bg-azul px-5 py-2.5 text-[14px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60">
            {ocupado ? "Guardando…" : form.id ? "Guardar cambios" : "Crear anuncio"}
          </button>
        </div>
      </div>

      {/* Lista de anuncios existentes */}
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-wide text-gris uppercase">
          Anuncios ({anuncios.length})
        </span>
        {anuncios.length === 0 ? (
          <p className="rounded-[14px] bg-tarjeta p-5 text-center text-[13px] font-medium text-gris">
            Todavía no hay anuncios. Creá el primero arriba.
          </p>
        ) : (
          anuncios.map((a) => {
            const estado = estadoPublicacion({ activo: a.activo, desde: a.fecha_inicio, hasta: a.fecha_fin });
            return (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-borde bg-tarjeta p-3">
              {a.imagen_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.imagen_url} alt="" className="h-9 w-9 flex-shrink-0 rounded-[12px] object-cover" />
              ) : (
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#EEF3FF] text-[12px] font-black text-azul tabular-nums"
                  title="Prioridad (mayor = primero)">
                  {a.prioridad}
                </span>
              )}
              <div className="flex min-w-0 flex-1 basis-[160px] flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-bold text-tinta">{a.titulo}</span>
                  {esAvisoCurbe(a.id) && (
                    <span className="flex-shrink-0 rounded-full bg-[#FBF1D9] px-1.5 py-0.5 text-[9.5px] font-black tracking-wide text-[#8A6A1F] uppercase">
                      🔗 curbe
                    </span>
                  )}
                </span>
                <span className="text-[11.5px] font-medium text-gris">
                  {a.segmento_def
                    ? describirSegmento(a.segmento_def, { zonas: Object.fromEntries(zonas.map((z) => [z.id, z.nombre])) })
                    : a.segmento === "todos" ? "Todos los clientes" : a.segmento === "al_dia" ? "Solo al día" : "Solo con pendientes"}
                  {" · "}{ventanaCorta(a.fecha_inicio, a.fecha_fin)}
                </span>
              </div>
              <EstadoBadge estado={estado} />
              <div className="flex items-center gap-1.5">
                <button onClick={() => toggle(a)} className="rounded-full border border-borde px-2.5 py-1 text-[11.5px] font-bold text-gris hover:bg-suave">
                  {a.activo ? "Pausar" : "Activar"}
                </button>
                <button onClick={() => editar(a)} className="rounded-full border border-borde px-2.5 py-1 text-[11.5px] font-bold text-azul hover:bg-suave">
                  Editar
                </button>
                <button onClick={() => duplicar(a)} title="Duplicar para relanzar" className="rounded-full border border-borde px-2.5 py-1 text-[11.5px] font-bold text-gris hover:bg-suave">
                  Duplicar
                </button>
                <button onClick={() => borrar(a)} aria-label="Borrar" className="text-[15px] text-[#C7D2EC] hover:text-[#D64545]">
                  ✕
                </button>
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

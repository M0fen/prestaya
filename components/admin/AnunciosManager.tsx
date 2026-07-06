"use client";
// Gestión de anuncios / publicidad de temporada (admin). Crear/editar, activar,
// programar por fechas, segmentar y priorizar SIN tocar código. Incluye una
// VISTA PREVIA en vivo de cómo se verá en la pantalla del cliente.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Anuncio, TemaAnuncio, SegmentoAnuncio } from "@/types/db";
import { BannerCarrusel } from "@/components/BannerCarrusel";
import { guardarAnuncio, alternarAnuncio, eliminarAnuncio, subirImagenAnuncio, type RawAnuncio } from "@/lib/acciones/anuncios";

const TEMAS: { v: TemaAnuncio; label: string }[] = [
  { v: "azul", label: "Azul" },
  { v: "verde", label: "Verde" },
  { v: "ambar", label: "Ámbar" },
  { v: "oscuro", label: "Oscuro" },
];
const SEGMENTOS: { v: SegmentoAnuncio; label: string }[] = [
  { v: "todos", label: "Todos" },
  { v: "al_dia", label: "Al día" },
  { v: "con_pendientes", label: "Con pendientes" },
];

const vacio: RawAnuncio = {
  id: null, titulo: "", cuerpo: "", ctaTexto: "", ctaUrl: "", imagenUrl: "",
  tema: "azul", prioridad: 0, activo: true, segmento: "todos", fechaInicio: "", fechaFin: "",
};

/** ISO → valor para <input datetime-local> ("YYYY-MM-DDTHH:mm"). */
function aLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AnunciosManager({ anuncios }: { anuncios: Anuncio[] }) {
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
      ctaUrl: a.cta_url ?? "", imagenUrl: a.imagen_url ?? "", tema: a.tema,
      prioridad: a.prioridad, activo: a.activo, segmento: a.segmento,
      fechaInicio: aLocal(a.fecha_inicio), fechaFin: aLocal(a.fecha_fin),
    });

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
    if (!confirm(`¿Borrar el anuncio "${a.titulo}"?`)) return;
    await eliminarAnuncio(a.id);
    if (form.id === a.id) setForm(vacio);
    router.refresh();
  };

  // Anuncio sintético para la vista previa (a partir del formulario).
  const preview: Anuncio = {
    id: "preview", titulo: form.titulo || "Título del anuncio",
    cuerpo: form.cuerpo || null, cta_texto: form.ctaTexto || null, cta_url: form.ctaUrl || null,
    imagen_url: form.imagenUrl || null, tema: form.tema as TemaAnuncio, prioridad: form.prioridad,
    activo: form.activo, segmento: form.segmento as SegmentoAnuncio,
    fecha_inicio: new Date().toISOString(), fecha_fin: null, creado_por: null,
    creado_en: "", actualizado_en: "",
  };

  const inputCls =
    "w-full rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul";

  return (
    <div className="flex flex-col gap-5">
      {/* Formulario + preview */}
      <div className="rounded-[18px] border border-[#E6EAF4] bg-white p-4">
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

        {/* Vista previa en vivo (cómo lo ve el cliente) */}
        <div className="mb-4 rounded-[16px] bg-[#EAEEF7] p-3">
          <span className="mb-2 block text-[10.5px] font-bold tracking-wide text-gris uppercase">
            Vista previa
          </span>
          <div className="mx-auto max-w-[380px]">
            <BannerCarrusel anuncios={[preview]} />
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <input className={inputCls} placeholder="Título *" maxLength={80}
            value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />
          <textarea className={`${inputCls} min-h-[60px]`} placeholder="Cuerpo (opcional)" maxLength={240}
            value={form.cuerpo ?? ""} onChange={(e) => set("cuerpo", e.target.value)} />
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
              <label className={`flex-shrink-0 cursor-pointer rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[12.5px] font-bold text-azul hover:bg-[#F4F6FB] ${subiendo ? "opacity-50" : ""}`}>
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
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-gris">
              A quién
              <select className={inputCls} value={form.segmento} onChange={(e) => set("segmento", e.target.value)}>
                {SEGMENTOS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
          </div>

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
          <p className="rounded-[14px] bg-white p-5 text-center text-[13px] font-medium text-gris">
            Todavía no hay anuncios. Creá el primero arriba.
          </p>
        ) : (
          anuncios.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-[14px] border border-[#E6EAF4] bg-white p-3">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-black text-white"
                style={{ background: a.activo ? "#1FA971" : "#AEB6CC" }}>
                {a.prioridad}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-bold text-tinta">{a.titulo}</span>
                <span className="text-[11.5px] font-medium text-gris">
                  {a.segmento === "todos" ? "Todos" : a.segmento === "al_dia" ? "Al día" : "Con pendientes"}
                  {a.activo ? "" : " · inactivo"}
                </span>
              </div>
              <button onClick={() => toggle(a)} className="rounded-full border border-[#DCE3F4] px-2.5 py-1 text-[11.5px] font-bold text-gris hover:bg-[#F4F6FB]">
                {a.activo ? "Pausar" : "Activar"}
              </button>
              <button onClick={() => editar(a)} className="rounded-full border border-[#DCE3F4] px-2.5 py-1 text-[11.5px] font-bold text-azul hover:bg-[#F4F6FB]">
                Editar
              </button>
              <button onClick={() => borrar(a)} aria-label="Borrar" className="text-[15px] text-[#C7D2EC] hover:text-[#D64545]">
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

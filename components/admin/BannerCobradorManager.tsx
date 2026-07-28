"use client";
// Panel del gestor para enviar un BANNER a la app del cobrador (arriba de su
// ruta). Dos usos en el mismo formulario:
//  · Aviso de texto (feriado, cierre, felicitación) → redactar + color.
//  · Oferta para compartir (curbe u otra) → título + imagen + botón. El cobrador
//    la comparte con su cliente en un toque (0080).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearBannerCobrador, actualizarBannerCobrador, desactivarBannerCobrador } from "@/lib/acciones/bannerCobrador";
import { subirImagenAnuncio } from "@/lib/acciones/anuncios";
import { BannerEquipo } from "@/components/cobrador/BannerEquipo";
import type { BannerCobrador, TemaBanner } from "@/lib/data/bannerCobrador";
import { estadoPublicacion } from "@/lib/publicacion";
import { EstadoBadge } from "@/components/admin/EstadoBadge";
import { esAvisoCurbe } from "@/lib/curbe";

const TEMAS: { id: TemaBanner; label: string; bg: string; fg: string; bd: string }[] = [
  { id: "azul", label: "Info", bg: "#E9F0FF", fg: "#1E47C8", bd: "#C6D6FB" },
  { id: "verde", label: "Bien", bg: "#E4F5EC", fg: "#157A50", bd: "#BFE6D2" },
  { id: "ambar", label: "Atención", bg: "#FDF3E2", fg: "#B9770E", bd: "#F0D9A8" },
  { id: "rojo", label: "Urgente", bg: "#FBE4E2", fg: "#C0392B", bd: "#F3C0B8" },
];
const temaDe = (t: TemaBanner) => TEMAS.find((x) => x.id === t) ?? TEMAS[0];

const VENCE = [
  { label: "Sin vencimiento", horas: 0 },
  { label: "1 día", horas: 24 },
  { label: "3 días", horas: 72 },
  { label: "1 semana", horas: 168 },
];

export function BannerCobradorManager({ banners }: { banners: BannerCobrador[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [tema, setTema] = useState<TemaBanner>("azul");
  const [horas, setHoras] = useState(0);
  // Campos de oferta (opcionales): si hay título/imagen/botón, es una tarjeta
  // para compartir; si no, un aviso de texto clásico.
  const [titulo, setTitulo] = useState("");
  const [imagenUrl, setImagenUrl] = useState("");
  const [ctaTexto, setCtaTexto] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const activos = banners.filter((b) => b.activo);
  const esOferta = Boolean(titulo.trim() || imagenUrl.trim() || ctaUrl.trim());
  // Una oferta no necesita texto; un aviso de texto sí (mínimo 3).
  const puedePublicar = esOferta || texto.trim().length >= 3;

  const limpiar = () => {
    setEditandoId(null);
    setTexto("");
    setTitulo("");
    setImagenUrl("");
    setCtaTexto("");
    setCtaUrl("");
    setTema("azul");
    setHoras(0);
  };

  /** Carga el formulario con un banner. Si `comoNuevo`, duplica (sin id). */
  const cargar = (b: BannerCobrador, comoNuevo = false) => {
    setEditandoId(comoNuevo ? null : b.id);
    setTexto(b.texto ?? "");
    setTitulo(b.titulo ?? "");
    setImagenUrl(b.imagenUrl ?? "");
    setCtaTexto(b.ctaTexto ?? "");
    setCtaUrl(b.ctaUrl ?? "");
    setTema(b.tema);
    setHoras(0);
    setError(null);
    setAbierto(true);
  };

  const subirImagen = async (file: File | null) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await subirImagenAnuncio(fd);
    setSubiendo(false);
    if (r.ok) setImagenUrl(r.url);
    else setError(r.error);
  };

  const publicar = () => {
    if (!puedePublicar || pendiente) return;
    setError(null);
    const payload = {
      texto,
      tema,
      expiraEnHoras: horas,
      titulo: titulo.trim() || null,
      imagenUrl: imagenUrl.trim() || null,
      ctaTexto: ctaTexto.trim() || null,
      ctaUrl: ctaUrl.trim() || null,
    };
    startTransition(async () => {
      const res = editandoId
        ? await actualizarBannerCobrador({ id: editandoId, ...payload })
        : await crearBannerCobrador(payload);
      if (res.ok) {
        limpiar();
        setAbierto(false);
        router.refresh();
      } else setError(res.error);
    });
  };

  const apagar = (id: string) => {
    startTransition(async () => {
      await desactivarBannerCobrador(id);
      router.refresh();
    });
  };

  const prev = temaDe(tema);

  // Banner sintético para la vista previa (misma tarjeta que verá el cobrador).
  const preview: BannerCobrador = {
    id: "preview",
    texto: texto || "Tu mensaje para el cobrador…",
    tema,
    activo: true,
    creadoEn: "",
    expiraEn: null,
    titulo: titulo.trim() || null,
    imagenUrl: imagenUrl.trim() || null,
    ctaTexto: ctaTexto.trim() || null,
    ctaUrl: ctaUrl.trim() || null,
  };

  const inputCls =
    "w-full rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul";

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">📣 Banner al equipo</span>
          <span className="text-[11.5px] font-medium text-tenue">
            Un aviso fijo arriba de la ruta, o una oferta para que el cobrador comparta con su cliente.
          </span>
        </div>
        {!abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-full bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white active:scale-[0.99]"
          >
            + Nuevo
          </button>
        )}
      </div>

      {abierto && (
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-suave p-3">
          {editandoId && (
            <span className="text-[12px] font-bold text-[#1E47C8]">✏️ Editando un banner activo</span>
          )}
          <textarea
            value={texto}
            maxLength={240}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            placeholder="Mensaje o descripción de la oferta. Ej: Perfumes y oro 18k de curbe, en cuotas."
            className="resize-none rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          />

          {/* Bloque OFERTA (opcional) */}
          <details className="rounded-[10px] border border-borde bg-tarjeta">
            <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-bold text-azul">
              🎁 Convertir en oferta para compartir (opcional)
            </summary>
            <div className="flex flex-col gap-2 px-3 pb-3">
              <input
                className={inputCls}
                maxLength={60}
                placeholder="Título de la oferta (ej: curbe · perfumería + oro 18k)"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} min-w-0 flex-1`}
                  placeholder="URL de imagen o subí una →"
                  value={imagenUrl}
                  onChange={(e) => setImagenUrl(e.target.value)}
                />
                <label
                  className={`flex-shrink-0 cursor-pointer rounded-[10px] border border-borde px-3 py-2 text-[12.5px] font-bold text-azul hover:bg-suave ${subiendo ? "opacity-50" : ""}`}
                >
                  {subiendo ? "Subiendo…" : "📷 Subir"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={subiendo}
                    onChange={(e) => {
                      subirImagen(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {imagenUrl && (
                <button
                  type="button"
                  onClick={() => setImagenUrl("")}
                  className="w-fit text-[11px] font-semibold text-gris hover:text-[#D64545]"
                >
                  Quitar imagen
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  maxLength={40}
                  placeholder="Texto del botón"
                  value={ctaTexto}
                  onChange={(e) => setCtaTexto(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Link a compartir (https://…)"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                />
              </div>
              <span className="text-[11px] font-medium text-tenue">
                El cobrador toca el botón y lo comparte con su cliente por WhatsApp (mensaje + link).
              </span>
            </div>
          </details>

          {/* Color (solo para avisos de texto) */}
          {!esOferta && (
            <div className="flex flex-wrap items-center gap-1.5">
              {TEMAS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTema(t.id)}
                  className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                  style={
                    tema === t.id ? { background: t.fg, color: "#fff" } : { background: t.bg, color: t.fg }
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <select
              value={horas}
              onChange={(e) => setHoras(Number(e.target.value))}
              className="w-fit rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[12.5px] outline-none focus:border-azul"
            >
              {VENCE.map((v) => (
                <option key={v.horas} value={v.horas}>
                  {v.label}
                </option>
              ))}
            </select>
            {editandoId && (
              <span className="text-[10.5px] font-medium text-tenue">
                Al guardar, el vencimiento se cuenta de nuevo desde ahora.
              </span>
            )}
          </div>

          {/* Vista previa (tal como la ve el cobrador) */}
          {(texto.trim() || esOferta) && (
            <div className="rounded-[12px] bg-[#EAEEF7] p-3">
              <span className="mb-2 block text-[10px] font-bold tracking-wide text-gris uppercase">
                Vista previa
              </span>
              {esOferta ? (
                <BannerEquipo banner={preview} />
              ) : (
                <div
                  className="rounded-[12px] border px-3 py-2 text-[12.5px] font-semibold"
                  style={{ background: prev.bg, color: prev.fg, borderColor: prev.bd }}
                >
                  {texto}
                </div>
              )}
            </div>
          )}

          {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                limpiar();
              }}
              className="rounded-full border border-borde bg-tarjeta px-4 py-2 text-[12.5px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={publicar}
              disabled={pendiente || !puedePublicar}
              className="flex-1 rounded-full bg-[#1FA971] px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-40"
            >
              {pendiente
                ? "Guardando…"
                : editandoId
                  ? "Guardar cambios"
                  : esOferta
                    ? "Publicar oferta"
                    : "Publicar aviso"}
            </button>
          </div>
        </div>
      )}

      {/* Activos */}
      {activos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold tracking-wide text-gris uppercase">
            Activos ({activos.length})
          </span>
          {activos.map((b) => {
            const t = temaDe(b.tema);
            const oferta = Boolean(b.ctaUrl || b.imagenUrl || b.titulo);
            const estado = estadoPublicacion({ activo: b.activo, hasta: b.expiraEn });
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2"
                style={oferta ? { background: "#FBF6E9", borderColor: "#EAD9AE" } : { background: t.bg, borderColor: t.bd }}
              >
                <span
                  className="flex min-w-0 flex-1 basis-[140px] items-center gap-1.5 text-[12.5px] font-semibold"
                  style={{ color: oferta ? "#8A6A1F" : t.fg }}
                >
                  <span className="truncate">{oferta ? `🎁 ${b.titulo || b.texto}` : b.texto}</span>
                  {esAvisoCurbe(b.id) && (
                    <span className="flex-shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[9.5px] font-black tracking-wide text-[#8A6A1F] uppercase">
                      🔗 curbe
                    </span>
                  )}
                </span>
                <EstadoBadge estado={estado} />
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => cargar(b)}
                    disabled={pendiente}
                    className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-azul disabled:opacity-40"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => cargar(b, true)}
                    disabled={pendiente}
                    title="Duplicar para relanzar"
                    className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-gris disabled:opacity-40"
                  >
                    Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => apagar(b.id)}
                    disabled={pendiente}
                    className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-gris disabled:opacity-40"
                  >
                    Pausar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

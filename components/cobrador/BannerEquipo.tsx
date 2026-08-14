"use client";
// Banner del equipo en la app del cobrador (aviso del admin, 0050 + 0080).
// Dos modos:
//  · TEXTO (clásico): un aviso corto de color, descartable de forma permanente
//    (recordado en localStorage por id, así no reaparece).
//  · OFERTA (0080): tarjeta con imagen + título + botón "Compartir con el
//    cliente" (abre el compartir nativo → WhatsApp con el mensaje y el link).
//    Se puede ocultar, pero vuelve en la próxima sesión (para seguir ofreciendo).
import { useEffect, useState } from "react";
import type { BannerCobrador } from "@/lib/data/bannerCobrador";
import { hrefSeguro } from "@/lib/seguridad";

const TEMA: Record<BannerCobrador["tema"], { bg: string; fg: string; bd: string; icono: string }> = {
  azul: { bg: "var(--color-azul-suave)", fg: "var(--color-azul)", bd: "var(--color-campo)", icono: "📣" },
  verde: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)", bd: "var(--color-verde-suave)", icono: "✅" },
  ambar: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", bd: "var(--color-ambar-suave)", icono: "⚠️" },
  rojo: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)", bd: "var(--color-rojo-suave)", icono: "🔴" },
};

const CLAVE = "banner-equipo-descartado";
const ORO = "#E6C67A";

export function BannerEquipo({ banner }: { banner: BannerCobrador }) {
  const [visible, setVisible] = useState(false);

  // ¿Es una oferta para compartir (curbe u otra)? Tiene botón, imagen o título.
  const esOferta = Boolean(banner.ctaUrl || banner.imagenUrl || banner.titulo);

  // Solo tras montar (localStorage no existe en el server). Las ofertas siempre
  // se muestran (reaparecen cada sesión); los avisos de texto respetan el descarte.
  useEffect(() => {
    if (esOferta) {
      setVisible(true);
      return;
    }
    try {
      setVisible(localStorage.getItem(CLAVE) !== banner.id);
    } catch {
      setVisible(true);
    }
  }, [banner.id, esOferta]);

  if (!visible) return null;

  const descartar = () => {
    // Oferta: se oculta solo en esta sesión (vuelve al reabrir para seguir
    // ofreciéndola). Aviso de texto: se recuerda como leído.
    if (!esOferta) {
      try {
        localStorage.setItem(CLAVE, banner.id);
      } catch {
        /* sin localStorage: igual se oculta en esta sesión */
      }
    }
    setVisible(false);
  };

  if (esOferta) return <TarjetaOferta banner={banner} onDescartar={descartar} />;

  const t = TEMA[banner.tema] ?? TEMA.azul;
  return (
    <div
      className="flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3"
      style={{ background: t.bg, borderColor: t.bd }}
    >
      <span className="text-[15px] leading-none">{t.icono}</span>
      <p className="flex-1 text-[12.5px] leading-[1.5] font-semibold" style={{ color: t.fg }}>
        {banner.texto}
      </p>
      <button
        type="button"
        onClick={descartar}
        aria-label="Descartar aviso"
        className="flex-shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold"
        style={{ color: t.fg }}
      >
        ✕
      </button>
    </div>
  );
}

/** Tarjeta de OFERTA: el cobrador la comparte con su cliente en un toque. */
function TarjetaOferta({ banner, onDescartar }: { banner: BannerCobrador; onDescartar: () => void }) {
  const href = hrefSeguro(banner.ctaUrl);
  const ctaTexto = banner.ctaTexto?.trim() || "Compartir con el cliente";

  const compartir = async () => {
    const texto = [banner.titulo, banner.texto].filter(Boolean).join(" — ");
    // Web Share (móvil): abre el selector nativo → el cobrador elige a su
    // cliente en WhatsApp y le llega el mensaje + el link. Si cancela, no pasa nada.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: banner.titulo ?? "Presta Ya",
          text: texto,
          url: href ?? undefined,
        });
      } catch {
        /* el usuario canceló el compartir: no hacemos nada */
      }
      return;
    }
    // Sin Web Share (escritorio): abrimos el link en otra pestaña.
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative overflow-hidden rounded-[16px] border border-[#EAD9AE] bg-tarjeta p-3.5 shadow-[0_10px_24px_rgba(120,90,20,0.10)]">
      {/* Brillo dorado sutil de fondo */}
      <div
        className="pointer-events-none absolute -top-[40px] -right-[30px] h-[120px] w-[120px] rounded-full"
        style={{ background: "rgba(230,198,122,0.16)" }}
      />
      <div className="relative flex items-start gap-3">
        {banner.imagenUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.imagenUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-[60px] w-[60px] flex-shrink-0 rounded-[12px] object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className="text-[10px] font-extrabold tracking-[0.14em] uppercase"
            style={{ color: "#B08828" }}
          >
            Para compartir
          </span>
          {banner.titulo && (
            <h4 className="m-0 text-[14.5px] leading-[1.25] font-extrabold text-tinta">
              {banner.titulo}
            </h4>
          )}
          <p className="m-0 text-[12px] leading-[1.45] font-medium text-gris">{banner.texto}</p>
        </div>
        <button
          type="button"
          onClick={onDescartar}
          aria-label="Ocultar por ahora"
          className="flex-shrink-0 rounded-full px-1.5 text-[13px] font-bold text-[#C9B583]"
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        onClick={compartir}
        className="relative mt-3 flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-extrabold active:scale-[0.99]"
        style={{ background: ORO, color: "#1A1206" }}
      >
        {ctaTexto}
        <span aria-hidden="true">↗</span>
      </button>
    </div>
  );
}

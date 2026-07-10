"use client";
// Banner del equipo en la app del cobrador (aviso del admin, 0050). Se muestra
// arriba de la ruta. Descartable por el cobrador (recordado en localStorage por
// id, así no reaparece); si el admin publica uno nuevo, vuelve a verse.
import { useEffect, useState } from "react";
import type { BannerCobrador } from "@/lib/data/bannerCobrador";

const TEMA: Record<BannerCobrador["tema"], { bg: string; fg: string; bd: string; icono: string }> = {
  azul: { bg: "#E9F0FF", fg: "#173a9e", bd: "#C6D6FB", icono: "📣" },
  verde: { bg: "#E4F5EC", fg: "#136243", bd: "#BFE6D2", icono: "✅" },
  ambar: { bg: "#FDF3E2", fg: "#96610b", bd: "#F0D9A8", icono: "⚠️" },
  rojo: { bg: "#FBE4E2", fg: "#a5301f", bd: "#F3C0B8", icono: "🔴" },
};

const CLAVE = "banner-equipo-descartado";

export function BannerEquipo({ banner }: { banner: BannerCobrador }) {
  const [visible, setVisible] = useState(false);

  // Solo tras montar (localStorage no existe en el server) y si no fue descartado.
  useEffect(() => {
    try {
      setVisible(localStorage.getItem(CLAVE) !== banner.id);
    } catch {
      setVisible(true);
    }
  }, [banner.id]);

  if (!visible) return null;
  const t = TEMA[banner.tema] ?? TEMA.azul;

  const descartar = () => {
    try {
      localStorage.setItem(CLAVE, banner.id);
    } catch {
      /* sin localStorage: igual se oculta en esta sesión */
    }
    setVisible(false);
  };

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

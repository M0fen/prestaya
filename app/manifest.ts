import type { MetadataRoute } from "next";

// ─────────────────────────────────────────────────────────────────────────
//  Web App Manifest (PWA). Next lo sirve en /manifest.webmanifest y lo enlaza
//  solo. Hace la app INSTALABLE: ícono en el inicio del teléfono, splash y
//  arranque en pantalla completa (standalone). Pensado para adultos mayores
//  (abren el ícono, no buscan el link) y para el cobrador en la calle.
//  Los íconos PNG se generan con scripts/gen-iconos-pwa.mjs.
// ─────────────────────────────────────────────────────────────────────────
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Presta Ya — Tu crédito diario",
    short_name: "Presta Ya",
    description: "Tu crédito de cobro diario, siempre a mano.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EAEEF7",
    theme_color: "#13308C",
    lang: "es-UY",
    dir: "ltr",
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

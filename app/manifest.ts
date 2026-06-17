import type { MetadataRoute } from "next";

// Manifest PWA: permite "agregar a inicio" y abrir como app (standalone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Presta Ya — Tu crédito diario",
    short_name: "Presta Ya",
    description: "Estado de cuenta de tu crédito de cobro diario.",
    start_url: "/",
    display: "standalone",
    background_color: "#EAEEF7",
    theme_color: "#13308C",
    lang: "es",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

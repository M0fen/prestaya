// ─────────────────────────────────────────────────────────────────────────
//  Genera los íconos PNG de la PWA a partir del logo (gradiente azul + "P").
//  Se corre UNA vez (o cuando cambie la marca):  node scripts/gen-iconos-pwa.mjs
//  Produce en public/icons/:
//    · icon-192.png / icon-512.png  → ícono normal (esquinas redondeadas)
//    · maskable-512.png             → full-bleed con zona segura (Android adaptativo)
//    · apple-180.png                → apple-touch-icon (iOS le pone su propia máscara)
// ─────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// Gradiente y "P" centrada. `rx` controla las esquinas; en maskable/apple va 0
// (sin redondear) porque el sistema operativo aplica su propia máscara.
function svg({ size, rx, escala }) {
  const s = size;
  const fs = Math.round(s * escala); // tamaño de la letra
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2453DC"/><stop offset="1" stop-color="#13308C"/>
  </linearGradient></defs>
  <rect width="${s}" height="${s}" rx="${rx}" fill="url(#g)"/>
  <text x="${s / 2}" y="${s * 0.5}" dy="0.35em" font-family="Inter, system-ui, sans-serif"
        font-size="${fs}" font-weight="900" fill="#FFFFFF" text-anchor="middle">P</text>
</svg>`;
}

async function png({ nombre, size, rx, escala }) {
  const buf = Buffer.from(svg({ size, rx, escala }));
  await sharp(buf).png().toFile(join(DIR, nombre));
  console.log("✓", nombre);
}

await mkdir(DIR, { recursive: true });
// Ícono normal: esquinas redondeadas ~22% (estilo "app").
await png({ nombre: "icon-192.png", size: 192, rx: 42, escala: 0.6 });
await png({ nombre: "icon-512.png", size: 512, rx: 112, escala: 0.6 });
// Maskable: sin redondear y la "P" más chica para respetar la zona segura (~80%).
await png({ nombre: "maskable-512.png", size: 512, rx: 0, escala: 0.46 });
// Apple: cuadrado pleno (iOS recorta a su gusto).
await png({ nombre: "apple-180.png", size: 180, rx: 0, escala: 0.6 });
console.log("Listo — íconos PWA en public/icons/");

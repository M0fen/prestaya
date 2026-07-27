// ─────────────────────────────────────────────────────────────────────────
//  Manifest PWA POR CLIENTE.
//
//  El manifest global (app/manifest.ts) tiene start_url "/" → pensado para el
//  EQUIPO (abre el login). Pero el CLIENTE instala la app desde SU cartón
//  (/c/[token]); en Android el ícono instalado usa el start_url del manifest, y
//  con "/" el adulto mayor caía en el login del equipo en vez de en su cartón.
//
//  Este manifest declara start_url y scope = /c/[token] → el ícono abre siempre
//  su cartón. `id` propio lo hace una app distinta de la del equipo. Lo enlaza
//  la página del cliente (generateMetadata → manifest), reemplazando al global.
//
//  No toca la base: solo valida la FORMA del token (un manifest para un token
//  inexistente es inofensivo; al abrirlo, el cartón devolvería 404 igual).
// ─────────────────────────────────────────────────────────────────────────
import { tokenValido } from "@/lib/validacion/esquemas";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenValido(token)) return new Response("No encontrado", { status: 404 });

  const base = `/c/${encodeURIComponent(token)}`;
  const manifest = {
    // `id` único → el teléfono la trata como una app propia (la del cliente),
    // separada de la app del equipo (start_url "/").
    id: base,
    name: "Mi cartón — Presta Ya",
    short_name: "Mi cartón",
    description: "Mirá cómo vas con tu crédito, cuándo pagás y tu comprobante.",
    // La clave del fix: el ícono instalado abre el cartón del cliente.
    start_url: base,
    scope: base,
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

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Cacheable, pero corto: si cambia el diseño del manifest, propaga pronto.
      "Cache-Control": "public, max-age=3600",
    },
  });
}

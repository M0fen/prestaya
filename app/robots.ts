// ─────────────────────────────────────────────────────────────────────────
//  robots.txt — endurecimiento post-dominio (08-04).
//
//  Presta Ya es una herramienta OPERATIVA, no un sitio a indexar. Lo único
//  con algún valor público es la portada y la tienda; todo lo demás se
//  excluye explícitamente, y en especial:
//   · /c/  → los cartones por TOKEN de los clientes. Un buscador que indexe
//     un link compartido por WhatsApp expondría el estado de una DEUDA real
//     en resultados de búsqueda (además del X-Robots-Tag, cinturón y tiradores).
//   · /admin, /cobrador, /mfa, /ingresar, /api → superficies internas: no
//     hay razón para que existan en un índice público.
//  robots.txt es una SEÑAL (no un control de acceso — eso es la sesión/RLS y
//  el token de 192 bits); reduce descubrimiento y ruido de crawlers.
// ─────────────────────────────────────────────────────────────────────────
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/c/", "/admin", "/cobrador", "/api/", "/ingresar", "/mfa", "/demo"],
      },
    ],
  };
}

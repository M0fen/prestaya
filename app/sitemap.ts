// Sitemap de lo PÚBLICO (barrida 15-08: cada ficha /tienda/[id] tiene OG y
// JSON-LD pero Google no tenía cómo descubrirlas). Solo la tienda: el resto de
// la app es privada (robots.ts ya la excluye).
import type { MetadataRoute } from "next";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos } from "@/lib/data/tienda";

export const dynamic = "force-dynamic";

const BASE = "https://prestaya.uy";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fijo: MetadataRoute.Sitemap = [
    { url: `${BASE}/tienda`, changeFrequency: "daily", priority: 1 },
  ];
  try {
    const productos = await getProductosPublicos(createSupabaseAdmin());
    return [
      ...fijo,
      ...productos.map((p) => ({
        url: `${BASE}/tienda/${p.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return fijo; // sin catálogo no se cae el sitemap: al menos la portada
  }
}

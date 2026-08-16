// FICHA PÚBLICA de un producto — /tienda/[id]. URL propia + Open Graph (preview con
// foto y precio al compartir por WhatsApp) + abre el detalle del producto. Estilo
// Mercado Libre: cada producto es compartible y muestra su tarjeta al pegar el link.
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/idempotencia";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos, getProductoPublicoPorId } from "@/lib/data/tienda";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
import { conTimeout } from "@/lib/timeout";
import { TiendaCliente } from "@/components/tienda/TiendaCliente";
import { NEGOCIO } from "@/lib/negocio";

export const dynamic = "force-dynamic";
const money = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createSupabaseAdmin();
  const p = await getProductoPublicoPorId(db, id).catch(() => null);
  if (!p) return { title: "Tienda Presta Ya" };
  const desc = `${money(p.precio)}${p.cuotas > 0 ? ` · en ${p.cuotas} cuotas` : ""}. Llevátelo en cuotas cómodas en la Tienda Presta Ya.`;
  const img = p.fotos[0] ? [{ url: p.fotos[0] }] : [];
  return {
    title: `${p.nombre} — Tienda Presta Ya`,
    description: desc,
    openGraph: { title: p.nombre, description: desc, images: img, type: "website" },
    twitter: { card: "summary_large_image", title: p.nombre, description: desc, images: p.fotos[0] ? [p.fotos[0]] : [] },
  };
}

export default async function ProductoPublicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Un id que ni siquiera es uuid es un 404, no un error de servidor (antes el
  // 22P02 de Postgres subía al error.tsx — "no pudimos cargar" por una URL rota).
  if (!esUuid(id)) notFound();
  const db = createSupabaseAdmin();
  // El catch fino quedó en la capa de datos (tabla ausente → null); cualquier
  // blip real sube al error.tsx — un timeout YA NO se disfraza de 404.
  const [prod, productos, usuario] = await Promise.all([
    getProductoPublicoPorId(db, id),
    conTimeout(getProductosPublicos(db), 22_000, "tienda.pdp"),
    getUsuarioActual().catch(() => null),
  ]);
  if (!prod) notFound();
  const logueado = usuario && usuario.activo ? usuario : null;
  const esEmpleado = !!logueado && (logueado.rol === "cobrador" || logueado.rol === "supervisor");
  // JSON-LD Product (patrón ML/Amazon): Google/WhatsApp entienden qué es y cuánto sale.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: prod.nombre,
    image: prod.fotos,
    description: prod.descripcion ?? `${prod.nombre} en cuotas cómodas — Tienda ${NEGOCIO.nombre}.`,
    ...(prod.marca ? { brand: { "@type": "Brand", name: prod.marca } } : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: "UYU",
      price: Math.round(prod.precio),
      availability: prod.agotado || prod.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
  };

  return (
    // overflow-x-clip: la banda 100vw de la cabecera generaba un bamboleo
    // horizontal de un par de píxeles en esta ruta (las otras dos ya lo tenían).
    <div className="flex min-h-screen justify-center overflow-x-clip bg-fondo text-tinta">
      {/* `<` escapado (acta pre-lunes): la descripción es texto libre del admin y
          un "</script>" literal cortaría el tag en una página PÚBLICA. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="flex w-full max-w-[480px] flex-col gap-3 bg-[#EBEEF5] px-[18px] pt-4 pb-12 shadow-[0_0_60px_rgba(15,27,61,0.08)] md:max-w-[1120px] md:px-8 md:pt-6">
        <div className="flex items-center justify-between">
          <Link href="/tienda" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[15px] font-black text-white">P</div>
            <span className="text-[15px] font-extrabold text-tinta">{NEGOCIO.nombre}</span>
          </Link>
          {logueado ? (
            <Link href={rutaHome(logueado.rol)} className="rounded-full border border-[#DCE3F4] bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-azul hover:bg-suave">
              Hola, {logueado.nombre.split(" ")[0]}
            </Link>
          ) : (
            <Link href="/ingresar" className="rounded-full border border-[#DCE3F4] bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-azul hover:bg-suave">Ingresar</Link>
          )}
        </div>
        <Link href="/tienda" className="-my-1 inline-flex w-fit items-center gap-1 py-2 pr-2 text-[12.5px] font-bold text-azul">← Volver a la tienda</Link>

        {/* Abre el detalle del producto compartido y deja seguir viendo el catálogo.
            Si el catálogo general falló en llegar VACÍO real, la ficha compartida
            igual se muestra (el producto existe: es lo que vinieron a ver). */}
        <TiendaCliente productos={productos.length > 0 ? productos : [prod]} token={null} modoPublico modoEmpleado={esEmpleado} conEncabezado={false} abrirId={id} />

        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          {NEGOCIO.nombre} · Financiación en cuotas. Dejanos tu interés y te contactamos con el precio y el plan para vos.
        </p>
      </div>
    </div>
  );
}

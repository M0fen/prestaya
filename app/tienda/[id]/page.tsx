// FICHA PÚBLICA de un producto — /tienda/[id]. URL propia + Open Graph (preview con
// foto y precio al compartir por WhatsApp) + abre el detalle del producto. Estilo
// Mercado Libre: cada producto es compartible y muestra su tarjeta al pegar el link.
import Link from "next/link";
import { notFound } from "next/navigation";
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
  const db = createSupabaseAdmin();
  const [prod, productos, usuario] = await Promise.all([
    getProductoPublicoPorId(db, id).catch(() => null),
    conTimeout(getProductosPublicos(db), 22_000, "tienda.pdp"),
    getUsuarioActual().catch(() => null),
  ]);
  if (!prod) notFound();
  const logueado = usuario && usuario.activo ? usuario : null;
  const esEmpleado = !!logueado && (logueado.rol === "cobrador" || logueado.rol === "supervisor");

  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
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

        {/* Abre el detalle del producto compartido y deja seguir viendo el catálogo. */}
        <TiendaCliente productos={productos} token={null} modoPublico modoEmpleado={esEmpleado} conEncabezado={false} abrirId={id} />

        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          {NEGOCIO.nombre} · Financiación en cuotas. Dejanos tu interés y te contactamos con el precio y el plan para vos.
        </p>
      </div>
    </div>
  );
}

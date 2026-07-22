// Vista previa de la TIENDA tal como la ve el cliente (precios base). Un espacio
// para que el dueño revise "cómo se ve en general" sin abrir el link de un
// cliente. Solo admin (la tienda es del dueño). "Me interesa" queda desactivado.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getProductosAdmin, type ProductoParaCliente } from "@/lib/data/tienda";
import { TiendaCliente } from "@/components/tienda/TiendaCliente";
import { NEGOCIO } from "@/lib/negocio";

export const dynamic = "force-dynamic";

export default async function TiendaVistaPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada"); // la tienda la gobierna el dueño
  const db = await createSupabaseServer();

  // Los productos activos con su precio BASE (sin override de cliente) — lo que
  // ve alguien "en general". getProductosAdmin ya trae la forma Producto.
  const base = await getProductosAdmin(db);
  const productos: ProductoParaCliente[] = base
    .filter((p) => p.activo)
    .map((p) => ({ ...p, precioPersonalizado: false }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <Link href="/admin/tienda" className="flex items-center gap-1 text-[13.5px] font-bold text-azul">
          ← Volver a la tienda
        </Link>
        <span className="rounded-full bg-[#EEF3FF] px-3 py-1 text-[11.5px] font-bold text-azul">Vista previa</span>
      </header>

      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-tinta">Así ve tu cliente la tienda</h1>
        <span className="text-[13px] font-medium text-gris">
          Con los precios base ({productos.length} {productos.length === 1 ? "producto activo" : "productos activos"}).
          El botón “Me interesa” está desactivado acá.
        </span>
      </div>

      {/* Marco tipo teléfono, para verla igual que el cliente */}
      <div className="flex justify-center">
        <div className="w-full max-w-[440px] rounded-[24px] border border-borde bg-app p-[18px] shadow-[0_16px_40px_rgba(15,27,61,0.10)]">
          {/* Encabezado de la tienda (igual que en el cartón del cliente) */}
          <div className="mb-3 flex items-center gap-2.5 rounded-[18px] bg-[linear-gradient(135deg,#2453DC,#13308C)] px-4 py-4 text-white shadow-[0_10px_28px_rgba(19,48,140,0.28)]">
            <span className="text-[30px]" aria-hidden="true">🛍️</span>
            <div className="flex flex-col">
              <span className="text-[18px] font-extrabold leading-tight">Tienda {NEGOCIO.nombre}</span>
              <span className="text-[12.5px] font-medium text-white/85">Electrodomésticos y más, en cuotas cómodas.</span>
            </div>
          </div>

          {productos.length === 0 ? (
            <div className="mt-2 flex flex-col items-center gap-2 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-12 text-center">
              <span className="text-[40px]" aria-hidden="true">🛒</span>
              <p className="text-[15px] font-bold text-tinta">Todavía no hay productos activos</p>
              <p className="max-w-[280px] text-[13px] font-medium text-gris">
                Publicá productos desde la tienda y acá vas a ver cómo le aparecen al cliente.
              </p>
              <Link href="/admin/tienda" className="mt-2 rounded-full bg-[#1E47C8] px-5 py-2.5 text-[14px] font-bold text-white">
                Ir a la tienda
              </Link>
            </div>
          ) : (
            <TiendaCliente productos={productos} token={null} preview conEncabezado={false} />
          )}
        </div>
      </div>
    </div>
  );
}

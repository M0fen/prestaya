// Tienda — gestión del catálogo de productos a crédito (SOLO admin: es del dueño).
// Productos (con fotos/carrusel + video + precio/interés/cuotas + precio por
// cliente), categorías y las solicitudes (leads) que dejan los clientes.
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getProductosAdmin, getCategorias, getSolicitudes } from "@/lib/data/tienda";
import { TiendaManager } from "@/components/admin/TiendaManager";

export const dynamic = "force-dynamic";

export default async function TiendaPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada"); // la tienda la gobierna el dueño
  const db = await createSupabaseServer();
  const [productos, categorias, solicitudes] = await Promise.all([
    getProductosAdmin(db),
    getCategorias(db, false),
    getSolicitudes(db),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <span className="text-[12px] font-bold uppercase tracking-wide text-azul">Para tus clientes</span>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Tienda</h1>
        <span className="text-[13px] font-medium text-gris">
          Publicá productos a crédito con fotos y video. El cliente los ve en su cartón y deja su interés.
        </span>
      </header>
      <TiendaManager productos={productos} categorias={categorias} solicitudes={solicitudes} />
    </div>
  );
}

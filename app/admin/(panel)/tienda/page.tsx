// Tienda — gestión del catálogo de productos a crédito (SOLO admin: es del dueño).
// Productos (con fotos/carrusel + video + precio/interés/cuotas + precio por
// cliente), categorías y las solicitudes (leads) que dejan los clientes.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getProductosAdmin, getCategorias, getSolicitudes } from "@/lib/data/tienda";
import { getLeadsPublicos } from "@/lib/data/leadsPublicos";
import { getPedidosCurbe } from "@/lib/data/pedidosCurbe";
import { getZonas } from "@/lib/data/zonas";
import { TiendaManager } from "@/components/admin/TiendaManager";
import { ProspectosPublicos } from "@/components/admin/ProspectosPublicos";

export const dynamic = "force-dynamic";

export default async function TiendaPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada"); // la tienda la gobierna el dueño
  const db = await createSupabaseServer();
  const [productos, categorias, solicitudes, zonas, leadsPublicos, pedidosCurbe] = await Promise.all([
    getProductosAdmin(db),
    getCategorias(db, false),
    getSolicitudes(db),
    getZonas(db),
    getLeadsPublicos(db),
    getPedidosCurbe(db),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-bold uppercase tracking-wide text-azul">Para tus clientes</span>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Tienda</h1>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <Link href="/admin/tienda/curbe" className="flex items-center gap-1.5 rounded-full border border-[#C9B8F0] bg-[#F3EEFC] px-3.5 py-2 text-[12.5px] font-bold text-[#6D4AC7] hover:brightness-[0.98]">
              💎 Curbe
            </Link>
            <Link href="/tienda" target="_blank" className="flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-3.5 py-2 text-[12.5px] font-bold text-azul hover:bg-suave">
              🌐 Tienda pública
            </Link>
            <Link href="/admin/tienda/vista" className="flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-3.5 py-2 text-[12.5px] font-bold text-azul hover:bg-suave">
              👁️ Ver como cliente
            </Link>
          </div>
        </div>
        <span className="text-[13px] font-medium text-gris">
          Publicá productos a crédito con fotos y video. El cliente los ve en su cartón y deja su interés.
        </span>
      </header>
      <ProspectosPublicos leads={leadsPublicos} />
      {/* Accesos a las herramientas de la tienda (Curbe + Proyección) */}
      {(() => {
        const curbePend = pedidosCurbe.filter((p) => p.estado === "pendiente").length;
        const curbeCount = productos.filter((p) => p.proveedor === "curbe").length;
        return (
          <div className="grid gap-2.5 md:grid-cols-3">
            <ToolCard href="/admin/tienda/ganancias" emoji="💰" titulo="Ganancias" desc="Cuánto ganás y de dónde viene cada peso." borde="border-[#BFE6D2] bg-[#EAF7F0]" flecha="#0F7A48" />
            <ToolCard href="/admin/tienda/clientes" emoji="🧑‍🤝‍🧑" titulo="Ventas a clientes" desc="Quién compró qué y cuánto pagó." borde="border-[#BFD4F5] bg-[#EEF3FF]" flecha="#1E47C8" />
            <ToolCard href="/admin/tienda/equipo" emoji="🧾" titulo="Compras del equipo" desc="Compras a crédito del equipo (descuento de comisión)." borde="border-[#BFD4F5] bg-[#EEF3FF]" flecha="#1E47C8" />
            <ToolCard href="/admin/tienda/proyeccion" emoji="📈" titulo="Proyección de ventas" desc="Estimá cuánto puede facturar la tienda." borde="border-[#BFE6D2] bg-[#EAF7F0]" flecha="#0F7A48" />
            {(curbeCount > 0 || pedidosCurbe.length > 0) && (
              <ToolCard href="/admin/tienda/curbe" emoji="💎" titulo="Integración Curbe" desc={`${curbeCount} productos · catálogo y despacho.`} badge={curbePend} borde="border-[#C9B8F0] bg-[#F3EEFC]" flecha="#6D4AC7" />
            )}
          </div>
        );
      })()}
      <TiendaManager
        productos={productos}
        categorias={categorias}
        solicitudes={solicitudes}
        zonas={zonas.map((z) => ({ id: z.id, nombre: z.nombre }))}
        esAdmin={esAdmin(u.rol)}
      />
    </div>
  );
}

// Tarjeta de acceso a una herramienta de la tienda (a nivel de módulo: no se puede
// crear un componente dentro del render).
function ToolCard({ href, emoji, titulo, desc, badge, borde, flecha }: { href: string; emoji: string; titulo: string; desc: string; badge?: number; borde: string; flecha: string }) {
  return (
    <Link href={href} className={`flex items-center justify-between gap-3 rounded-[16px] border p-4 hover:brightness-[0.99] ${borde}`}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">{emoji} {titulo}</span>
        <span className="text-[12px] font-medium text-gris">{desc}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {badge != null && badge > 0 && <span className="rounded-full bg-[#E8A317] px-2.5 py-1 text-[11px] font-black text-[#0F1B3D]">{badge}</span>}
        <span className="text-[18px]" style={{ color: flecha }}>→</span>
      </div>
    </Link>
  );
}

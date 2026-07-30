// Ganancias de la tienda (0114) — SOLO admin. De dónde viene cada peso + rentabilidad.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { getGananciasTienda } from "@/lib/data/ganancias";
import { GananciasTiendaPanel } from "@/components/admin/GananciasTienda";

export const dynamic = "force-dynamic";

export default async function GananciasPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const g = await getGananciasTienda();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">💰 Ganancias de la tienda</h1>
        <span className="text-[13px] font-medium text-gris">
          Cuánto te deja cada producto y de dónde viene el dinero: clientes, equipo, Curbe y propios.
        </span>
      </header>
      <GananciasTiendaPanel g={g} />
    </div>
  );
}

// Proyección de ventas de la tienda (SOLO admin). Simulador con números reales
// (clientes, catálogo) + supuestos ajustables → potencial de facturación.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { getBaseProyeccion } from "@/lib/data/proyeccion";
import { ProyeccionVentas } from "@/components/admin/ProyeccionVentas";

export const dynamic = "force-dynamic";

export default async function ProyeccionPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const base = await getBaseProyeccion();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">📈 Proyección de ventas</h1>
        <span className="text-[13px] font-medium text-gris">
          Estimá el potencial de la tienda con tus clientes reales. Elegí un escenario o ajustá los supuestos.
        </span>
      </header>
      <ProyeccionVentas base={base} />
    </div>
  );
}

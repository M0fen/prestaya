// Ventas a clientes (control) — SOLO admin. Los créditos que vinieron de una
// compra en la tienda: quién compró, inicio, progreso y saldo.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { getVentasClientes } from "@/lib/data/ventasClientes";
import { VentasClientes } from "@/components/admin/VentasClientes";

export const dynamic = "force-dynamic";

export default async function VentasClientesPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const { ventas, resumen } = await getVentasClientes();
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">🧑‍🤝‍🧑 Ventas a clientes</h1>
        <span className="text-[13px] font-medium text-gris">
          Los clientes que compraron en la tienda a crédito: qué llevaron, cuándo empezó y cuánto pagaron.
        </span>
      </header>
      <VentasClientes ventas={ventas} resumen={resumen} />
    </div>
  );
}

// Compras del equipo a crédito (0113) — SOLO admin. Quién compró qué, saldo,
// inicio del crédito e historial de descuentos de comisión.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getComprasEmpleado, getResumenComprasEmpleado } from "@/lib/data/comprasEmpleado";
import { ComprasEquipo } from "@/components/admin/ComprasEquipo";

export const dynamic = "force-dynamic";

export default async function ComprasEquipoPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const db = await createSupabaseServer();
  const [compras, resumen] = await Promise.all([getComprasEmpleado(db), getResumenComprasEmpleado(db)]);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">🧾 Compras del equipo</h1>
        <span className="text-[13px] font-medium text-gris">
          Lo que cobradores y supervisores compraron a crédito. La cuota se descuenta de su comisión al liquidarla.
        </span>
      </header>
      <ComprasEquipo compras={compras} resumen={resumen} />
    </div>
  );
}

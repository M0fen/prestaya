// Calculadora de precios (0114) — SOLO admin. Margen, financiación, ganancia,
// precio sugerido y comparador de planes. Precarga productos reales.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getProductosAdmin } from "@/lib/data/tienda";
import { CalculadoraPrecios } from "@/components/admin/CalculadoraPrecios";

export const dynamic = "force-dynamic";

export default async function CalculadoraPage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const db = await createSupabaseServer();
  const productos = await getProductosAdmin(db);
  const items = productos.map((p) => ({
    id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo, interesPct: p.interesPct, cuotas: p.cuotas,
  }));
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">🧮 Calculadora de precios</h1>
        <span className="text-[13px] font-medium text-gris">
          Fijá precios con margen, financiación y ganancia. Precargá un producto o probá valores.
        </span>
      </header>
      <CalculadoraPrecios productos={items} />
    </div>
  );
}

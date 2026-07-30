// Hub de la integración CURBE (0112) — SOLO admin (la tienda es del dueño).
// KPIs de la integración + cola de despacho + catálogo Curbe.
import { redirect } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getProductosCurbe } from "@/lib/data/tienda";
import { getCurbeResumen, getPedidosCurbe } from "@/lib/data/pedidosCurbe";
import { CurbeHub } from "@/components/admin/CurbeHub";

export const dynamic = "force-dynamic";

export default async function CurbePage() {
  const u = await requireGestor();
  if (!esAdmin(u.rol)) redirect("/admin/jornada");
  const db = await createSupabaseServer();
  const [resumen, productos, pedidos] = await Promise.all([
    getCurbeResumen(db),
    getProductosCurbe(db),
    getPedidosCurbe(db),
  ]);
  return <CurbeHub resumen={resumen} productos={productos} pedidos={pedidos} />;
}

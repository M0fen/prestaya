// Aprobación de GASTOS DE RUTA (solo admin). Bandeja de solicitudes pendientes:
// el cobrador pidió sacar plata para un gasto; el admin aprueba (crea el egreso)
// o rechaza. Recién aprobado el gasto sale de la caja.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSolicitudesGastoPendientes } from "@/lib/data/solicitudesGasto";
import { SolicitudesGasto } from "@/components/admin/SolicitudesGasto";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const pendientes = await getSolicitudesGastoPendientes(db);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Gastos de ruta</h1>
        <span className="text-[13px] font-medium text-gris">
          Solicitudes de los cobradores para sacar de la caja. Solo vos las aprobás; recién ahí sale la plata.
        </span>
      </div>
      <SolicitudesGasto solicitudes={pendientes} />
    </div>
  );
}

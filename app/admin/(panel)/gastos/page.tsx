// GASTOS DE RUTA. Bandeja de solicitudes pendientes: el cobrador pidió sacar plata
// para un gasto. El SUPERVISOR las VE (acotadas a su zona); solo el ADMIN aprueba
// (crea el egreso) o rechaza. Recién aprobado el gasto sale de la caja.
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSolicitudesGastoPendientes, getSolicitudesGastoResueltas } from "@/lib/data/solicitudesGasto";
import { alcanceDelActor } from "@/lib/data/alcance";
import { SolicitudesGasto } from "@/components/admin/SolicitudesGasto";
import { HistorialGastos } from "@/components/admin/HistorialGastos";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  const usuario = await requireGestor();
  const admin = esAdmin(usuario.rol);
  const db = await createSupabaseServer();
  // El supervisor ve SOLO los gastos de sus cobradores (acotado por zona).
  const alcance = await alcanceDelActor();
  const cobIds = alcance.global ? null : alcance.cobradorIds;
  const [pendientes, resueltos] = await Promise.all([
    getSolicitudesGastoPendientes(db, cobIds),
    getSolicitudesGastoResueltas(db, cobIds),
  ]);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Gastos de ruta</h1>
        <span className="text-[13px] font-medium text-gris">
          {admin
            ? "Solicitudes de los cobradores para sacar de la caja. Solo vos las aprobás; recién ahí sale la plata."
            : "Solicitudes de tus cobradores para sacar de la caja. Las aprueba el administrador; acá las seguís de cerca."}
        </span>
      </div>
      <SolicitudesGasto solicitudes={pendientes} puedeAprobar={admin} />
      {/* Historial: recupera la evidencia (comprobante, quién/cuándo resolvió) que
          antes desaparecía al aprobar/rechazar. Trazabilidad anti-fraude a posteriori. */}
      <HistorialGastos resueltos={resueltos} />
    </div>
  );
}

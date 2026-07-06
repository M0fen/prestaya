// Estrellas (admin): canjes de estrellas por aprobar. Los fragmentos se derivan
// de los pagos reales (1 pago = 1 fragmento; 5 = 1 estrella); acá el gestor
// aprueba/rechaza las solicitudes de canje. El premio lo entrega la oficina.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRedencionesPendientes } from "@/lib/data/estrellas";
import { RedencionesManager } from "@/components/admin/RedencionesManager";

export const dynamic = "force-dynamic";

export default async function EstrellasPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const pendientes = await getRedencionesPendientes(db);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Estrellas</h1>
        <span className="text-[13px] font-medium text-gris">
          Canjes por aprobar. Cada 5 pagos, el cliente gana una estrella; puede canjear hasta
          5 por mes. Al aprobar, entregás el premio.
        </span>
      </div>

      {pendientes.length > 0 && (
        <span className="text-[12px] font-bold tracking-wide text-gris uppercase">
          Pendientes ({pendientes.length})
        </span>
      )}
      <RedencionesManager pendientes={pendientes} />

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Las estrellas se calculan solas a partir de los pagos reales (no se pueden “trucar”): si un
        pago se anula, su fragmento desaparece. Requiere la migración 0020.
      </p>
    </div>
  );
}

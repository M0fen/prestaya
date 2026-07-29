// Estrellas (admin): canjes de estrellas por aprobar. Los fragmentos se derivan
// de los pagos reales (1 pago = 1 fragmento; 5 = 1 estrella); acá el gestor
// aprueba/rechaza las solicitudes de canje. El premio lo entrega la oficina.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRedencionesPendientes, getHistorialRedenciones, getMetricasEstrellas } from "@/lib/data/estrellas";
import { RedencionesManager } from "@/components/admin/RedencionesManager";
import { RedimirEstrellas } from "@/components/admin/RedimirEstrellas";
import { RegistroRedenciones } from "@/components/admin/RegistroRedenciones";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function EstrellasPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [pendientes, historial, metricas] = await Promise.all([
    getRedencionesPendientes(db),
    getHistorialRedenciones(db, 100),
    getMetricasEstrellas(db),
  ]);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Estrellas</h1>
          <span className="text-[13px] font-medium text-gris">
            Canjes por aprobar. Cada 5 pagos, el cliente gana una estrella; puede canjear hasta
            5 por mes. Al aprobar, entregás el premio.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" nota="el canje desde la app del cliente está en pausa" />
      </div>

      {/* Redención directa del admin (en persona). */}
      <RedimirEstrellas />

      {pendientes.length > 0 && (
        <span className="text-[12px] font-bold tracking-wide text-gris uppercase">
          Solicitudes pendientes ({pendientes.length})
        </span>
      )}
      <RedencionesManager pendientes={pendientes} />

      {/* Registro de redención: métricas + historial verificable con folio/entrega/premio. */}
      <RegistroRedenciones historial={historial} metricas={metricas} />

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Las estrellas se calculan solas a partir de los pagos reales (no se pueden “trucar”): si un
        pago se anula, su fragmento desaparece. Requiere la migración 0020.
      </p>
    </div>
  );
}

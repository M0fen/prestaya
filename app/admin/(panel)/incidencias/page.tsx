// Bandeja de INCIDENCIAS (solo admin, 0107): los reportes de bugs/problemas que
// dejan los usuarios con el botón "Reportar un problema", para triage.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getIncidencias } from "@/lib/data/incidencias";
import { IncidenciasManager } from "@/components/admin/IncidenciasManager";

export const dynamic = "force-dynamic";

export default async function IncidenciasPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const incidencias = await getIncidencias(db);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Incidencias</h1>
        <span className="text-[13px] font-medium text-gris">
          Los problemas que reporta el equipo desde la app (botón 🐞 “Reportar”). Triagealos acá.
        </span>
      </div>
      <IncidenciasManager incidencias={incidencias} />
      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Cada reporte trae la pantalla y el usuario. Complementa la captura automática de errores
        (Sentry/logs). Requiere la migración 0107.
      </p>
    </div>
  );
}

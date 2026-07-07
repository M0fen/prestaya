// Gestión de ZONAS (SOLO admin). Crear zonas, mover cobradores entre zonas y
// asignar supervisores a sus zonas. Es el cimiento del acceso por zona: la RLS
// (0031) recién restringe al supervisor cuando acá le asignás su primera zona.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  getZonas,
  getEquipoConZona,
  getSupervisoresPorZona,
  getConteoCobradoresPorZona,
} from "@/lib/data/zonas";
import { GestionZonas } from "@/components/admin/GestionZonas";

export const dynamic = "force-dynamic";

export default async function ZonasPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [zonas, equipo, supervisoresPorZona, conteo] = await Promise.all([
    getZonas(db),
    getEquipoConZona(db),
    getSupervisoresPorZona(db),
    getConteoCobradoresPorZona(db),
  ]);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Zonas</h1>
        <span className="text-[13px] font-medium text-gris">
          Territorios de cobro. El cobrador va en una zona; el supervisor cubre las que le asignes.
          Un supervisor sin zonas ve todo hasta que le pongas la primera.
        </span>
      </div>

      <GestionZonas
        zonas={zonas}
        equipo={equipo}
        supervisoresPorZona={supervisoresPorZona}
        conteo={conteo}
      />
    </div>
  );
}

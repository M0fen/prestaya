// Control de la ZONA DE JUEGO (admin/supervisor): encendido, juego del mes,
// meta de racha, premio y mensajes. Lo que se guarda acá lo ve el cliente.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getRecompensas } from "@/lib/data/recompensas";
import { getDashboardMetricas } from "@/lib/data/metricas";
import { JUEGOS } from "@/lib/juegos";
import { FormAjustesJuego } from "@/components/admin/FormAjustesJuego";
import { RecompensasManager } from "@/components/admin/RecompensasManager";

export const dynamic = "force-dynamic";

export default async function JuegoPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const [ajustes, recompensas] = await Promise.all([getAjustesJuego(db), getRecompensas(db)]);
  const juegos = Object.values(JUEGOS).map((j) => ({ id: j.id, titulo: j.titulo }));

  // Progreso colectivo de la temporada: % de créditos activos al día.
  let pctAlDia: number | null = null;
  if (ajustes.temporadaActiva) {
    try {
      const m = await getDashboardMetricas(db);
      pctAlDia =
        m.creditosActivos > 0
          ? Math.round(((m.creditosActivos - m.morosos) / m.creditosActivos) * 100)
          : null;
    } catch {
      pctAlDia = null;
    }
  }

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Zona de juego</h1>
        <span className="text-[13px] font-medium text-gris">
          Controlá lo que ven tus clientes: mascota, recompensas, temporada y el juego del mes.
        </span>
      </div>

      {ajustes.temporadaActiva && pctAlDia !== null && (
        <div className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-bold text-tinta">
              {ajustes.temporadaEmoji} {ajustes.temporadaNombre || "Temporada"}
            </span>
            <span className="text-[12px] font-semibold text-gris">
              {pctAlDia}% al día · meta {ajustes.temporadaMeta}%
            </span>
          </div>
          <div className="h-[10px] w-full overflow-hidden rounded-full bg-[#EDF1F9]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#2FB47C,#1FA971)]"
              style={{ width: `${Math.min(100, Math.round((pctAlDia / Math.max(1, ajustes.temporadaMeta)) * 100))}%` }}
            />
          </div>
        </div>
      )}

      <FormAjustesJuego inicial={ajustes} juegos={juegos} />
      <RecompensasManager recompensas={recompensas} />

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Las misiones, el nivel y las recompensas se calculan solos a partir de los pagos reales (no se
        pueden “trucar”). Vos definís las metas, los premios, la temporada y qué juego se muestra.
      </p>
    </div>
  );
}

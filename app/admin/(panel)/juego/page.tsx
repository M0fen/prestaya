// Control de la ZONA DE JUEGO (admin/supervisor): encendido, juego del mes,
// meta de racha, premio y mensajes. Lo que se guarda acá lo ve el cliente.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getRecompensas } from "@/lib/data/recompensas";
import { getDashboardMetricas } from "@/lib/data/metricas";
import { JUEGOS } from "@/lib/juegos";
import { juegoArcadeDe } from "@/lib/juegoAjustes";
import { FormAjustesJuego } from "@/components/admin/FormAjustesJuego";
import { RecompensasManager } from "@/components/admin/RecompensasManager";
import { GameSlot } from "@/components/GameSlot";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function JuegoPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [ajustes, recompensas] = await Promise.all([getAjustesJuego(db), getRecompensas(db)]);
  const juegos = Object.values(JUEGOS).map((j) => ({ id: j.id, titulo: j.titulo }));
  // Juego arcade seleccionado (para el preview jugable de abajo). Se muestra
  // aunque la zona esté apagada, para poder probarlo antes de encenderla.
  const juegoPreview = juegoArcadeDe(ajustes);

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
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Zona de juego</h1>
          <span className="text-[13px] font-medium text-gris">
            Controlá lo que ven tus clientes: recompensas, temporada y el juego del mes.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" nota="el arcade y la temporada están en pausa por ahora" />
      </div>

      {ajustes.temporadaActiva && pctAlDia !== null && (
        <div className="rounded-[16px] border border-borde bg-tarjeta p-4">
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

      {/* Preview JUGABLE del juego seleccionado: así el gestor lo prueba acá
          mismo antes (o después) de encender la zona para los clientes. */}
      {juegoPreview && (
        <section className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-extrabold text-tinta">
              Probá el juego · {juegoPreview.titulo}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                ajustes.activo ? "bg-[#E7F6EF] text-[#157A50]" : "bg-[#FBF1DC] text-[#9A6A0E]"
              }`}
            >
              {ajustes.activo ? "Visible para clientes" : "Zona apagada (solo vos lo ves acá)"}
            </span>
          </div>
          <span className="text-[12px] font-medium text-gris">
            Este es el juego que verán tus clientes. Jugalo para probarlo.
          </span>
          <GameSlot juego={juegoPreview} />
        </section>
      )}

      <RecompensasManager recompensas={recompensas} />

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Las misiones, el nivel y las recompensas se calculan solos a partir de los pagos reales (no se
        pueden “trucar”). Vos definís las metas, los premios, la temporada y qué juego se muestra.
      </p>
    </div>
  );
}

// Anuncios / publicidad de temporada (admin). Mauricio y su esposa gestionan
// campañas sin tocar código: crear/editar/activar, programar por fechas,
// segmentar y priorizar, con vista previa de cómo lo ve el cliente. La temporada
// visual del mes (nombre/emoji/meta/premio) se define en "Zona de juego".
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAnunciosAdmin } from "@/lib/data/anuncios";
import { AnunciosManager } from "@/components/admin/AnunciosManager";

export const dynamic = "force-dynamic";

export default async function AnunciosPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const anuncios = await getAnunciosAdmin(db);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Anuncios</h1>
        <span className="text-[13px] font-medium text-gris">
          Campañas y novedades que ven tus clientes. Programalas por fecha, elegí a quién y con
          qué prioridad. La “temporada” del mes se configura en Zona de juego.
        </span>
      </div>

      <AnunciosManager anuncios={anuncios} />
    </div>
  );
}

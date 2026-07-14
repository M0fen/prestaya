// Anuncios / publicidad de temporada (admin). Mauricio y su esposa gestionan
// campañas sin tocar código: crear/editar/activar, programar por fechas,
// segmentar y priorizar, con vista previa de cómo lo ve el cliente. La temporada
// visual del mes (nombre/emoji/meta/premio) se define en "Zona de juego".
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAnunciosAdmin } from "@/lib/data/anuncios";
import { AnunciosManager } from "@/components/admin/AnunciosManager";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function AnunciosPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const anuncios = await getAnunciosAdmin(db);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Anuncios al cliente</h1>
          <span className="text-[13px] font-medium text-gris">
            Comunicale lo que quieras a tus clientes en su pantalla.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" />
      </div>

      {/* Qué podés hacer (para que el admin vea todo el control que tiene). */}
      <div className="flex flex-col gap-2 rounded-[16px] border border-[#D9E4FF] bg-[#EEF3FF] p-4">
        <span className="text-[13.5px] font-extrabold text-[#1E47C8]">Podés comunicar de todo:</span>
        <div className="grid gap-x-4 gap-y-1 text-[12.5px] font-medium text-cuerpo sm:grid-cols-2">
          <span>📝 <b>Título y texto</b> libres</span>
          <span>🖼️ <b>Foto/imagen</b> (subís desde tu equipo)</span>
          <span>🔘 <b>Botón</b> con enlace (WhatsApp, promo, etc.)</span>
          <span>🎨 <b>Color/tema</b> del banner</span>
          <span>🎯 <b>A quién</b>: todos, al día o con pendientes</span>
          <span>📅 <b>Cuándo</b>: fecha de inicio y fin</span>
          <span>⬆️ <b>Prioridad</b>: cuál se ve primero</span>
          <span>👁️ <b>Vista previa</b> de cómo lo ve el cliente</span>
        </div>
      </div>

      <AnunciosManager anuncios={anuncios} />
    </div>
  );
}

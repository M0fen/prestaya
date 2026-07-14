// Chat interno (panel admin/supervisor): canal del equipo + un hilo por cada
// cobrador. El canal activo va en ?c=. Ver componentes en components/chat.
import { requireUsuario, esGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCanales, getMensajesVista } from "@/lib/data/chat";
import { ChatVista } from "@/components/chat/ChatVista";

export const dynamic = "force-dynamic";

export default async function ChatAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const usuario = await requireUsuario();
  const db = await createSupabaseServer();

  const canales = await getCanales(db, usuario);
  const activo = canales.find((x) => x.key === c) ?? canales[0];
  const mensajes = activo
    ? await getMensajesVista(db, activo.ambito, activo.cobradorId, activo.zonaId, usuario.id)
    : [];

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Chat interno</h1>
        <span className="text-[13px] font-medium text-gris">
          Coordinación del equipo. El canal del cobrador es privado entre él y la oficina.
        </span>
      </div>

      {/* El "Banner al equipo" ahora vive en su propia sección (Para tu equipo);
          desde acá solo lo señalamos para que se descubra. */}
      {esGestor(usuario.rol) && (
        <a
          href="/admin/banner-equipo"
          className="flex items-center gap-3 rounded-[14px] border border-linea bg-app px-4 py-3 transition-colors hover:bg-fondo"
        >
          <span className="text-[18px]" aria-hidden>📢</span>
          <span className="flex-1 text-[13px] font-semibold text-tinta">
            ¿Querés avisarle a <b>todos los cobradores</b> a la vez? Poné un{" "}
            <b>Banner al equipo</b> arriba de su ruta.
          </span>
          <span className="text-[15px] font-bold text-gris" aria-hidden>→</span>
        </a>
      )}

      <ChatVista
        basePath="/admin/chat"
        canales={canales}
        canalActivo={activo?.key ?? "general"}
        mensajes={mensajes}
        esAdmin={usuario.rol === "admin"}
      />
    </div>
  );
}

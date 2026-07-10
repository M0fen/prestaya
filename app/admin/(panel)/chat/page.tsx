// Chat interno (panel admin/supervisor): canal del equipo + un hilo por cada
// cobrador. El canal activo va en ?c=. Ver componentes en components/chat.
import { requireUsuario, esGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCanales, getMensajesVista } from "@/lib/data/chat";
import { getBannersCobrador } from "@/lib/data/bannerCobrador";
import { ChatVista } from "@/components/chat/ChatVista";
import { BannerCobradorManager } from "@/components/admin/BannerCobradorManager";

export const dynamic = "force-dynamic";

export default async function ChatAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const usuario = await requireUsuario();
  const db = await createSupabaseServer();

  const [canales, banners] = await Promise.all([
    getCanales(db, usuario),
    getBannersCobrador(db),
  ]);
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

      {/* Banner al equipo (aviso a la app del cobrador). */}
      {esGestor(usuario.rol) && <BannerCobradorManager banners={banners} />}

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

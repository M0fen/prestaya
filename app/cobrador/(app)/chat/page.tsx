// Chat interno (app del cobrador): canal del equipo + su hilo privado con la
// oficina. El canal activo va en ?c=.
import { requireUsuario } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCanales, getMensajesVista } from "@/lib/data/chat";
import { ChatVista } from "@/components/chat/ChatVista";

export const dynamic = "force-dynamic";

export default async function ChatCobradorPage({
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
    ? await getMensajesVista(db, activo.ambito, activo.cobradorId, usuario.id)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[19px] font-extrabold text-tinta">Chat</h1>
      <ChatVista
        basePath="/cobrador/chat"
        canales={canales}
        canalActivo={activo?.key ?? "general"}
        mensajes={mensajes}
      />
    </div>
  );
}

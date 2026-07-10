// Chat interno (app del cobrador): canal del equipo + su hilo privado con la
// oficina. El canal activo va en ?c=.
import Link from "next/link";
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
    ? await getMensajesVista(db, activo.ambito, activo.cobradorId, activo.zonaId, usuario.id)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold text-tinta">Chat</h1>
        {/* Salida clara a la ruta (además del escape del logo en el header). */}
        <Link
          href="/cobrador"
          className="flex items-center gap-1.5 rounded-full bg-[#EEF3FF] px-3.5 py-1.5 text-[12.5px] font-bold text-azul active:scale-95"
        >
          ← Volver a la ruta
        </Link>
      </div>
      <ChatVista
        basePath="/cobrador/chat"
        canales={canales}
        canalActivo={activo?.key ?? "general"}
        mensajes={mensajes}
      />
    </div>
  );
}

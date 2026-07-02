"use client";
// Avisos en vivo para el panel. Escucha inserciones en el chat general (Supabase
// Realtime) y, cuando entra un mensaje de OTRA persona, lanza un toast que lleva
// al chat y refresca (para actualizar el badge de no leídos). Si ya estás en el
// chat, no molesta con toasts. El cuerpo viaja cifrado: no lo mostramos.
import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { notificar } from "@/lib/ui/toast";

const VENTANA_REFRESH_MS = 1200;

export function NotificacionesRealtime({ yoId }: { yoId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const enChat = pathname?.startsWith("/admin/chat") ?? false;
  // Refs para leer el valor vigente dentro del callback sin re-suscribir.
  const enChatRef = useRef(enChat);
  enChatRef.current = enChat;
  const ultimoRefresh = useRef(0);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    const canal = supabase
      .channel("avisos-chat-general")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensajes",
          filter: "ambito=eq.general",
        },
        (payload) => {
          const fila = payload.new as { autor_id?: string } | null;
          if (!fila || fila.autor_id === yoId) return; // ignorar los míos

          // Refresco throttleado para actualizar el badge de no leídos.
          const ahora = Date.now();
          if (ahora - ultimoRefresh.current > VENTANA_REFRESH_MS) {
            ultimoRefresh.current = ahora;
            router.refresh();
          }

          // Toast solo si NO estás mirando el chat en este momento.
          if (!enChatRef.current) {
            notificar({
              tipo: "info",
              titulo: "Nuevo mensaje",
              mensaje: "Tenés un mensaje en el chat del equipo.",
              href: "/admin/chat",
            });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [yoId, router]);

  return null;
}

"use client";
// Aviso EN VIVO del chat para el cobrador: enciende el badge de no-leídos del
// bottom-nav cuando llega un mensaje que puede ver (la oficina le manda una orden
// a su hilo privado o a su zona). Sin toast: en la calle no interrumpe; el badge
// del pulgar alcanza. La RLS de Realtime solo entrega sus canales visibles.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const VENTANA_MS = 1500;

export function AvisoChatCobrador({ yoId }: { yoId: string }) {
  const router = useRouter();
  const ultimo = useRef(0);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    const canal = supabase
      .channel("cobrador-chat-badge")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes" },
        (payload) => {
          const fila = payload.new as { autor_id?: string } | null;
          if (!fila || fila.autor_id === yoId) return; // ignorar los míos
          const ahora = Date.now();
          if (ahora - ultimo.current > VENTANA_MS) {
            ultimo.current = ahora;
            router.refresh(); // enciende el badge de no-leídos del bottom-nav
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

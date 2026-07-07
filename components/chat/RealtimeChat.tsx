"use client";
// Suscripción en vivo (Supabase Realtime) al canal de chat abierto. Cuando
// entra un mensaje nuevo, refresca la vista (RSC) para traerlo YA. No usa el
// contenido del evento (viaja cifrado): el servidor re-lee y descifra al
// refrescar. El refresh va THROTTLEADO: en una ráfaga de mensajes no dispara
// N recargas del servidor (era una causa del chat "lento/raro").
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import type { AmbitoMensaje } from "@/types/db";

const VENTANA_MS = 700; // máx. una recarga por esta ventana

export function RealtimeChat({
  ambito,
  cobradorId,
  zonaId = null,
}: {
  ambito: AmbitoMensaje;
  cobradorId: string | null;
  zonaId?: string | null;
}) {
  const router = useRouter();
  const ultimoRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Refresco throttleado (leading + trailing): si llegan 10 mensajes juntos,
    // recarga a lo sumo ~una vez por ventana, no 10.
    const refrescar = () => {
      const ahora = Date.now();
      const resto = VENTANA_MS - (ahora - ultimoRefresh.current);
      if (resto <= 0) {
        ultimoRefresh.current = ahora;
        router.refresh();
      } else if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
          ultimoRefresh.current = Date.now();
          router.refresh();
        }, resto);
      }
    };

    const supabase = createSupabaseBrowser();
    const filter =
      ambito === "cobrador" && cobradorId
        ? `cobrador_id=eq.${cobradorId}`
        : ambito === "zona" && zonaId
          ? `zona_id=eq.${zonaId}`
          : ambito === "supervisores"
            ? "ambito=eq.supervisores"
            : "ambito=eq.general";

    const canal = supabase
      .channel(`mensajes-${ambito}-${cobradorId ?? zonaId ?? "gen"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mensajes", filter },
        () => refrescar(),
      )
      .subscribe((estado) => {
        // Al (re)suscribir bien, traé lo que haya podido perderse mientras tanto.
        if (estado === "SUBSCRIBED") refrescar();
      });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(canal);
    };
  }, [ambito, cobradorId, zonaId, router]);

  return null;
}

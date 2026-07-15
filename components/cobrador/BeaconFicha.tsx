"use client";
// Beacon de bitácora: al abrir la ficha de un cliente, captura el GPS y registra
// "ver_ficha" (best-effort, una sola vez). Prueba dónde estaba el cobrador al
// mirar al cliente. No muestra nada.
import { useEffect, useRef } from "react";
import { registrarVerFicha } from "@/app/cobrador/(app)/actions";

export function BeaconFicha({ clienteId }: { clienteId: string }) {
  const enviado = useRef(false);
  useEffect(() => {
    if (enviado.current) return;
    enviado.current = true;
    const enviar = (lat: number | null, lng: number | null, denegado: boolean) => {
      void registrarVerFicha({ clienteId, gpsLat: lat, gpsLng: lng, gpsDenegado: denegado }).catch(
        () => {},
      );
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      enviar(null, null, true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => enviar(p.coords.latitude, p.coords.longitude, false),
      () => enviar(null, null, true),
      // maximumAge bajo (8s) para no heredar el fix de otra pantalla como si fuera
      // fresco (mismo criterio que el cobro); timeout algo más holgado para el lock.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 8000 },
    );
  }, [clienteId]);
  return null;
}

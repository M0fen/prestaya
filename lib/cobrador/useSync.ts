"use client";
// Motor de sincronización de la cola offline. Vacía la cola contra las Server
// Actions cuando hay conexión (single-flight), con reintentos. Expone estado
// para el badge. Al sincronizar algo, avisa (para refrescar la vista).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  confirmar,
  hidratar,
  marcarIntento,
  opAtascada,
  pendientes,
  suscribir,
} from "@/lib/cobrador/colaOffline";
import {
  registrarPagoCobrador,
  registrarNoPagoCobrador,
} from "@/app/cobrador/(app)/actions";
import type { MotivoNoPago } from "@/app/cobrador/(app)/motivos";

export function useSync(onSynced?: () => void) {
  const ops = useSyncExternalStore(suscribir, pendientes, () => []);
  const [online, setOnline] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const flushing = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    hidratar();
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || typeof navigator === "undefined" || !navigator.onLine) return;
    const cola = pendientes();
    if (cola.length === 0) return;

    // Ventana de "Deshacer"/GPS: no enviar las ops aún retenidas; reprogramar el
    // flush para cuando venza la más próxima (así se envían solas, sin depender
    // de otro evento). Las ya vencidas se envían ahora.
    const ahora = Date.now();
    // No reintentar las ATASCADAS (agotaron los reintentos): dejan de spamear al
    // server; el cobrador las resuelve/descarta a mano desde el cierre.
    const listas = cola.filter((o) => (!o.holdHasta || o.holdHasta <= ahora) && !opAtascada(o));
    const enEspera = cola.filter((o) => o.holdHasta && o.holdHasta > ahora);
    if (enEspera.length > 0) {
      const prox = Math.min(...enEspera.map((o) => o.holdHasta as number)) - ahora;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => void flush(), Math.max(250, prox));
    }
    if (listas.length === 0) return;

    flushing.current = true;
    setSincronizando(true);
    let algunoOk = false;
    try {
      for (const op of listas) {
        const registradoEn = new Date(op.deviceTs).toISOString();
        try {
          const res =
            op.tipo === "pago"
              ? await registrarPagoCobrador({
                  clienteId: op.clienteId,
                  prestamoId: op.prestamoId ?? null,
                  monto: op.monto,
                  gpsLat: op.gpsLat,
                  gpsLng: op.gpsLng,
                  registradoEn,
                  opId: op.id,
                })
              : await registrarNoPagoCobrador({
                  clienteId: op.clienteId,
                  prestamoId: op.prestamoId ?? null,
                  motivo: (op.motivo ?? "no_estaba") as MotivoNoPago,
                  gpsLat: op.gpsLat,
                  gpsLng: op.gpsLng,
                  registradoEn,
                  opId: op.id,
                });
          if (res.ok) {
            // Éxito: sale de la cola con "gracia" (la UI optimista la sigue
            // mostrando unos segundos hasta que el refresco del server la refleje).
            confirmar(op.id);
            algunoOk = true;
          } else {
            // Error de negocio (p. ej. sin crédito activo): queda visible.
            marcarIntento(op.id);
          }
        } catch {
          break; // se cayó la red: cortar y reintentar más tarde
        }
      }
    } finally {
      flushing.current = false;
      setSincronizando(false);
      if (algunoOk) onSyncedRef.current?.();
    }
  }, []);

  // Auto-flush al volver online o al aparecer nuevos pendientes.
  useEffect(() => {
    if (online && ops.length > 0) void flush();
  }, [online, ops.length, flush]);

  return { pendientes: ops, online, sincronizando, flush };
}

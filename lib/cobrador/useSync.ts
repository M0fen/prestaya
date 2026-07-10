"use client";
// Motor de sincronización de la cola offline. Vacía la cola contra las Server
// Actions cuando hay conexión (single-flight), con reintentos. Expone estado
// para el badge. Al sincronizar algo, avisa (para refrescar la vista).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  hidratar,
  marcarIntento,
  pendientes,
  quitar,
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
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || typeof navigator === "undefined" || !navigator.onLine) return;
    const cola = pendientes();
    if (cola.length === 0) return;

    flushing.current = true;
    setSincronizando(true);
    let algunoOk = false;
    try {
      for (const op of cola) {
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
            quitar(op.id);
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

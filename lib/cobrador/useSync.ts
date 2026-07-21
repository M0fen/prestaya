"use client";
// Motor de sincronización de la cola offline. Vacía la cola contra las Server
// Actions cuando hay conexión (single-flight), con reintentos. Expone estado
// para el badge. Al sincronizar algo, avisa (para refrescar la vista).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  confirmar,
  configurarUsuario,
  hidratar,
  marcarAtascada,
  opAtascada,
  pendientes,
  suscribir,
} from "@/lib/cobrador/colaOffline";
import {
  registrarPagoCobrador,
  registrarNoPagoCobrador,
} from "@/app/cobrador/(app)/actions";
import type { MotivoNoPago } from "@/app/cobrador/(app)/motivos";

export function useSync(usuarioId: string | null, onSynced?: () => void) {
  const ops = useSyncExternalStore(suscribir, pendientes, () => []);
  const [online, setOnline] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const flushing = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reintentoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    // Particiona la cola por cobrador ANTES de hidratar: en un teléfono compartido
    // cada sesión sincroniza SOLO sus cobros (no los del cobrador anterior).
    configurarUsuario(usuarioId);
    hidratar();
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      // Limpiar Y poner a null: el efecto está keyeado en [usuarioId], y en un
      // teléfono COMPARTIDO cambia sin desmontar. Si el ref quedara con el handle
      // viejo (non-null), el gate `!reintentoTimer.current` bloquearía para siempre
      // el auto-reintento del nuevo cobrador → cobros temporales sin re-sincronizar.
      if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      if (reintentoTimer.current) { clearTimeout(reintentoTimer.current); reintentoTimer.current = null; }
    };
  }, [usuarioId]);

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
    let huboTemporal = false; // un fallo TEMPORAL cortó el flush → reprogramar reintento
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
                  gpsPrecision: op.gpsPrecision ?? null,
                  registradoEn,
                  opId: op.id,
                })
              : await registrarNoPagoCobrador({
                  clienteId: op.clienteId,
                  prestamoId: op.prestamoId ?? null,
                  motivo: (op.motivo ?? "no_estaba") as MotivoNoPago,
                  gpsLat: op.gpsLat,
                  gpsLng: op.gpsLng,
                  gpsPrecision: op.gpsPrecision ?? null,
                  registradoEn,
                  opId: op.id,
                });
          if (res.ok) {
            // Éxito: sale de la cola con "gracia" (la UI optimista la sigue
            // mostrando unos segundos hasta que el refresco del server la refleje).
            confirmar(op.id);
            algunoOk = true;
          } else if (res.retryable) {
            // Fallo TEMPORAL (kill switch, error de red/DB, sesión): NO envenenar el
            // cobro. Es sistémico → cortar el flush y reintentar TODO más tarde. Sin
            // esto, un freeze de emergencia terminaba marcando cobros reales como
            // "atascados" y el cierre le pedía al cobrador DESCARTARLOS (fuga real).
            huboTemporal = true;
            break;
          } else {
            // Error PERMANENTE (crédito finalizado/saldado/reasignado, datos inválidos):
            // reintentar daría el MISMO error → se marca ATASCADA de INMEDIATO. Antes se
            // hacía marcarIntento (intentos→1) y, como un error permanente no cambia
            // `ops.length`, el auto-flush no volvía a correr → la op quedaba clavada en
            // intentos=1: bloqueaba el cierre (sigue "pendiente") pero nunca llegaba a
            // "atascada" (Descartar) → el cobrador quedaba TRABADO. Ahora pasa directo a
            // atascada: no bloquea y aparece para descartar/re-registrar.
            marcarAtascada(op.id);
          }
        } catch {
          huboTemporal = true;
          break; // se cayó la red: cortar y reintentar más tarde
        }
      }
    } finally {
      flushing.current = false;
      setSincronizando(false);
      if (algunoOk) onSyncedRef.current?.();
      // Reintento programado ante un fallo temporal: así un kill switch / caída
      // sostenida se reintenta sola cuando se levanta, sin depender de que el
      // cobrador cargue otro cobro o recargue la app. (Un solo timer a la vez.)
      if (huboTemporal && !reintentoTimer.current) {
        reintentoTimer.current = setTimeout(() => {
          reintentoTimer.current = null;
          void flush();
        }, 25_000);
      }
    }
  }, []);

  // Auto-flush al volver online o al aparecer nuevos pendientes.
  useEffect(() => {
    if (online && ops.length > 0) void flush();
  }, [online, ops.length, flush]);

  return { pendientes: ops, online, sincronizando, flush };
}

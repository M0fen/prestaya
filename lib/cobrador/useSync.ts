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
  marcarIntento,
  opAtascada,
  pendientes,
  suscribir,
  type OpCobro,
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
    let frenoSistemico = false; // señal INEQUÍVOCA (kill switch/sesión/red) → cortar y reintentar TODO
    // Ops que fallaron con un retryable AMBIGUO (catch-all del server: red/DB/timeout
    // per-op). NO cortan el batch: se juntan y, al final, se decide si escalarlas.
    const ambiguas: OpCobro[] = [];
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
                  adelanto: op.adelanto ?? false,
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
          } else if (res.retryable && res.sistemico) {
            // Temporal SISTÉMICO (kill switch, sesión): afecta a TODA la cola por igual.
            // Cortar el flush y reintentar TODO más tarde, SIN acumular intentos. Sin
            // esto, un freeze de emergencia marcaba cobros reales como "atascados" y el
            // cierre pedía DESCARTARLOS (fuga real). Las ops de atrás no se tocan.
            frenoSistemico = true;
            break;
          } else if (res.retryable) {
            // Temporal AMBIGUO (catch-all: red/DB/timeout). Puede ser un glitch pasajero
            // O un error DETERMINISTA de ESTA op (p. ej. statement-timeout sobre un
            // crédito con historial pesado). NO cortamos el batch: seguimos con el resto
            // (anti head-of-line: una op envenenada ya no traba a las de atrás). Se anota
            // para decidir al final si se escala (evidencia de per-op) o no (red caída).
            ambiguas.push(op);
          } else if ((res as { duplicado?: boolean }).duplicado) {
            // DUPLICADO frenado por el candado anti doble-toque: el primer cobro YA
            // está en el libro, así que esta op no es plata perdida — es la misma
            // plata dos veces. Se confirma (sale de la cola) en vez de marcarla
            // atascada: dejarla ahí haría que el cierre le pidiera al cobrador
            // "registralo de nuevo" un cobro que justamente no hay que registrar.
            confirmar(op.id);
            algunoOk = true;
          } else {
            // Error PERMANENTE (crédito finalizado/saldado/reasignado, datos inválidos):
            // reintentar daría el MISMO error → se marca ATASCADA de INMEDIATO (no bloquea
            // el cierre; aparece para descartar/re-registrar).
            marcarAtascada(op.id);
          }
        } catch {
          // El propio llamado a la Server Action tiró (fetch failed): la red se cayó =
          // señal sistémica. Cortar y reintentar todo, sin envenenar.
          frenoSistemico = true;
          break;
        }
      }

      // Escalar las ambiguas SIEMPRE que NO haya habido freno SISTÉMICO en este pase.
      // frenoSistemico=false significa que el server RESPONDIÓ a cada op (no fue una
      // caída de red ni el kill switch): entonces una ambigua es un fallo PER-OP
      // (determinista sobre ese crédito) o un hipo transitorio del server. En ambos
      // casos hay que ACUMULAR intento: un hipo se recupera en pocos pases, y una op
      // envenenada (aunque sea la ÚNICA de la cola) llega a MAX_INTENTOS_SYNC y cae a
      // "atascada" → sale del reintento y aparece en el cierre para descartar/
      // re-registrar (op_id protegido por idempotencia, no duplica). Sin esto, una op
      // poison solitaria (algunoOk=false, intentos=0) reintentaba para siempre y
      // bloqueaba el cierre de la jornada. Durante un corte de red (frenoSistemico),
      // NO se escala: no marcamos cobros reales como atascados en pleno freeze.
      if (!frenoSistemico) {
        for (const op of ambiguas) marcarIntento(op.id);
      }
    } finally {
      flushing.current = false;
      setSincronizando(false);
      if (algunoOk) onSyncedRef.current?.();
      // Reintento programado ante cualquier fallo temporal (sistémico o ambiguo): así un
      // kill switch / caída sostenida se reintenta sola al levantarse, sin depender de
      // que el cobrador cargue otro cobro o recargue la app. (Un solo timer a la vez.)
      if ((frenoSistemico || ambiguas.length > 0) && !reintentoTimer.current) {
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

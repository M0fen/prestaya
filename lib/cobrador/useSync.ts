"use client";
// Motor de sincronización de la cola offline — la CÁSCARA: timers, estado y
// eventos. Las decisiones de plata del drenaje (qué se envía, qué corta el
// batch, qué escala a atascada) viven en lib/cobrador/drenarCola, que tiene
// su propio harness de tests con dobles.
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
} from "@/lib/cobrador/colaOffline";
import {
  registrarPagoCobrador,
  registrarNoPagoCobrador,
} from "@/app/cobrador/(app)/actions";
import { drenarCola } from "@/lib/cobrador/drenarCola";

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

    flushing.current = true;
    setSincronizando(true);
    let veredicto: Awaited<ReturnType<typeof drenarCola>> | null = null;
    try {
      // Todas las decisiones de plata viven en drenarCola (testeada con dobles);
      // acá solo se le inyectan las dependencias REALES.
      veredicto = await drenarCola(cola, {
        registrarPago: registrarPagoCobrador,
        registrarNoPago: registrarNoPagoCobrador,
        confirmar,
        marcarAtascada,
        marcarIntento,
        opAtascada,
        ahora: Date.now,
      });
    } finally {
      flushing.current = false;
      setSincronizando(false);
      if (veredicto?.algunoOk) onSyncedRef.current?.();
      // Op retenida (ventana de Deshacer/GPS): reprogramar el flush para cuando
      // venza la más próxima — se envía sola, sin depender de otro evento.
      if (veredicto?.proximoHoldMs != null) {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => void flush(), veredicto.proximoHoldMs);
      }
      // Reintento programado ante cualquier fallo temporal (sistémico o ambiguo):
      // un kill switch / caída sostenida se reintenta sola al levantarse, sin
      // depender de que el cobrador cargue otro cobro. (Un solo timer a la vez.)
      if (veredicto?.reintentar && !reintentoTimer.current) {
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

  // ⚠️ EMPUJÓN MANUAL ("Intentar subirlos ahora" del cierre de jornada).
  //
  // Antes ese botón despachaba un evento `online` falso, y era DECORATIVO: el
  // único que lo escucha hace `setOnline(true)`, y si el teléfono ya se cree
  // conectado —el caso normal: barras llenas, datos que no pasan— escribir el
  // MISMO valor no re-renderiza, así que el efecto de arriba no vuelve a correr y
  // `flush` nunca se llamaba. Peor: tocarlo estando sin señal dejaba `online` en
  // true, y cuando la señal volvía DE VERDAD el evento real del navegador también
  // quedaba en no-op → la cola dejaba de subir sola hasta cerrar y reabrir la app.
  //
  // Con un evento propio se llama al flush REAL, sin tocar el estado de conexión.
  useEffect(() => {
    const forzar = () => void flush();
    window.addEventListener("py:sync", forzar);
    return () => window.removeEventListener("py:sync", forzar);
  }, [flush]);

  return { pendientes: ops, online, sincronizando, flush };
}

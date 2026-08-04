"use client";
// Activa/desactiva avisos PUSH en ESTE dispositivo (admin/supervisor/cobrador).
// Pide permiso, se suscribe con la clave pública VAPID y guarda la suscripción.
// Si no hay clave configurada, NO muestra nada (feature oculto hasta cargar
// NEXT_PUBLIC_VAPID_PUBLIC_KEY; al cargarla reaparece el toggle solo).
import { useEffect, useState } from "react";
import { guardarSuscripcion, borrarSuscripcion } from "@/lib/acciones/push";

// base64url (VAPID) → Uint8Array (applicationServerKey). Sobre un ArrayBuffer
// explícito para satisfacer el tipo BufferSource (TS 5.7+).
function base64aUint8(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Estado = "cargando" | "no_soportado" | "off" | "on" | "activando";

/** ¿iPhone/iPad? En iOS los avisos web SOLO existen si la app está agregada a
 *  la pantalla de inicio (Safari suelto no tiene PushManager). Sin distinguirlo,
 *  el usuario no ve NADA y cree que la función no existe. */
function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** ¿Está corriendo como app instalada (standalone) y no como pestaña? */
function esInstalada(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function ActivarAvisos({
  vapidPublicKey,
  /** true = el que mira es admin: si falta la clave VAPID hay que DECÍRSELO
   *  (para el resto se oculta, no es su problema). */
  avisarSiFaltaConfig = false,
}: {
  vapidPublicKey: string | null;
  avisarSiFaltaConfig?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [error, setError] = useState("");

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setEstado("no_soportado");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEstado(sub ? "on" : "off"))
      .catch(() => setEstado("off"));
  }, []);

  const activar = async () => {
    setError("");
    setEstado("activando");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setError("Permiso denegado. Activalo desde el candado del navegador.");
        setEstado("off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64aUint8(vapidPublicKey!),
        }));
      const json = sub.toJSON();
      const res = await guardarSuscripcion({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
      if (res.ok) setEstado("on");
      else {
        setError(res.error);
        setEstado("off");
      }
    } catch {
      setError("No se pudo activar en este dispositivo.");
      setEstado("off");
    }
  };

  const desactivar = async () => {
    setError("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await borrarSuscripcion(sub.endpoint);
        await sub.unsubscribe();
      }
      setEstado("off");
    } catch {
      setError("No se pudo desactivar.");
    }
  };

  if (estado === "cargando") return null;

  // Falta la clave pública VAPID en el entorno. Antes esto se ocultaba en
  // silencio: el dueño entraba, no veía ningún botón y concluía que la función
  // no existía. Al admin se le dice qué falta; al resto no se le muestra nada.
  if (!vapidPublicKey) {
    if (!avisarSiFaltaConfig) return null;
    return (
      <span className="rounded-full bg-[#FDF3E2] px-3 py-1.5 text-[11px] font-bold text-[#8A6D1F]">
        🔔 Avisos sin configurar: falta <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> en Vercel
      </span>
    );
  }

  // Navegador sin push. En iPhone es lo NORMAL hasta instalar la app, así que
  // se explica el paso exacto en vez de desaparecer (era el caso real: se
  // entraba desde Safari y no aparecía nada).
  if (estado === "no_soportado") {
    if (esIOS() && !esInstalada()) {
      return (
        <span className="max-w-[260px] text-right text-[11px] leading-[1.45] font-semibold text-gris">
          🔔 Para recibir avisos en iPhone: tocá <b>Compartir</b> → <b>Agregar a inicio</b>, abrí
          Presta Ya desde ese ícono y volvé acá.
        </span>
      );
    }
    return (
      <span className="text-[11px] font-semibold text-gris">
        🔔 Este navegador no soporta avisos. Probá con Chrome.
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {estado === "on" ? (
        <button
          type="button"
          onClick={desactivar}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#E4F5EC] px-3 py-1.5 text-[11.5px] font-bold text-[#157A50]"
        >
          🔔 Avisos activados
        </button>
      ) : (
        <button
          type="button"
          onClick={activar}
          disabled={estado === "activando"}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#2453DC] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-60"
        >
          🔔 {estado === "activando" ? "Activando…" : "Activar avisos"}
        </button>
      )}
      {error && <span className="text-[10.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}

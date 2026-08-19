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

type Estado = "cargando" | "no_soportado" | "off" | "on" | "activando" | "bloqueado";

/** Dónde se re-habilitan las notificaciones cuando el navegador ya las bloqueó.
 *  "Activalo desde el candado" no alcanza: en Android el candado no siempre está,
 *  y en iOS la opción no vive en el navegador sino en los Ajustes del teléfono. */
function comoDesbloquear(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) {
    return "En el iPhone: Ajustes → Notificaciones → Presta Ya → activá “Permitir notificaciones”. Después volvé acá y tocá el botón de nuevo.";
  }
  if (/Android/.test(ua)) {
    return "En el celular: tocá el ícono a la izquierda de la dirección web (candado o ⓘ) → Permisos → Notificaciones → Permitir. Si no aparece, entrá a ⋮ → Configuración del sitio → Notificaciones. Después recargá la página.";
  }
  return "En la computadora: tocá el candado a la izquierda de la dirección web → Notificaciones → Permitir, y recargá la página.";
}

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
  /** TARJETA protagonista (piloto 19-08: 0 suscripciones en toda la base — la
   *  píldora de 11 px arriba a la derecha no la tocó nadie). Solo se pinta si
   *  los avisos están apagados; con ellos activos devuelve null. `motivo` dice
   *  por qué importa AHORA ("tenés 2 pedidos esperando"). */
  protagonista = false,
  motivo,
}: {
  vapidPublicKey: string | null;
  avisarSiFaltaConfig?: boolean;
  protagonista?: boolean;
  motivo?: string;
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
    // `serviceWorker.ready` NO resuelve hasta que hay un SW ACTIVO controlando la
    // página; si todavía no se registró (primera visita, PWA sin instalar, o el
    // SW tardando), la promesa queda colgada PARA SIEMPRE. El componente se
    // quedaba en "cargando" → devolvía null → el botón no aparecía nunca y no
    // había forma de saber por qué (esto era lo que le pasaba al dueño en el
    // celular). Se corre contra un tope de 3s: si no hay SW listo, igual se
    // muestra el botón —al tocarlo se pide el permiso y ahí sí se espera.
    // Permiso YA denegado: el navegador no vuelve a preguntar nunca (requestPermission
    // devuelve "denied" al instante, sin mostrar el cartel). Hay que decirle DÓNDE
    // se cambia, no dejarlo tocando un botón que no puede funcionar.
    if (Notification.permission === "denied") {
      setEstado("bloqueado");
      return;
    }
    let vivo = true;
    const conTope = Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    conTope
      .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
      .then((sub) => {
        if (vivo) setEstado(sub ? "on" : "off");
      })
      .catch(() => {
        if (vivo) setEstado("off");
      });
    return () => {
      vivo = false;
    };
  }, []);

  const activar = async () => {
    setError("");
    setEstado("activando");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        // "denied" acá casi siempre significa que ya estaba bloqueado de antes:
        // el navegador ni muestra el cartel. Se pasa al estado que EXPLICA cómo
        // desbloquearlo en ese dispositivo.
        setEstado(permiso === "denied" ? "bloqueado" : "off");
        return;
      }
      // Acá SÍ se espera al SW (el usuario ya tocó el botón). Si no hay ninguno
      // registrado, se registra el de la PWA antes de suscribir.
      if (!(await navigator.serviceWorker.getRegistration())) {
        await navigator.serviceWorker.register("/sw.js").catch(() => {});
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
  // Protagonista: solo tiene sentido cuando hay algo que activar.
  if (protagonista && (estado === "on" || !vapidPublicKey)) return null;

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

  // Bloqueado por el navegador: el botón NO puede funcionar hasta que el usuario
  // cambie el permiso a mano. Se le da la ruta exacta de su dispositivo.
  if (estado === "bloqueado") {
    return (
      <div className="flex max-w-[300px] flex-col items-end gap-1 rounded-[12px] bg-ambar-suave p-2.5 text-right">
        <span className="text-[11.5px] font-bold text-ambar-osc">🔕 Los avisos están bloqueados en este navegador</span>
        <span className="text-[11px] leading-[1.45] font-medium text-ambar-osc">{comoDesbloquear()}</span>
      </div>
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

  if (protagonista) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[14px] border-2 border-[#F0D9A8] bg-[#FFF8E8] px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13.5px] font-extrabold text-tinta">🔔 Activá los avisos en este celular</span>
          <span className="text-[12px] leading-[1.45] font-medium text-ambar-osc">
            {motivo ?? "Te llega cada pedido de la calle, cada corrección y cada faltante al cierre — sin tener que entrar a mirar."}
          </span>
          {error && <span className="text-[11px] font-semibold text-[#C0392B]">{error}</span>}
        </div>
        <button
          type="button"
          onClick={activar}
          disabled={estado === "activando"}
          className="flex-shrink-0 rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60 active:scale-95"
        >
          {estado === "activando" ? "Activando…" : "Activar"}
        </button>
      </div>
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

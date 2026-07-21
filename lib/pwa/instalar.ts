"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Store compartido de INSTALACIÓN de la PWA. El evento `beforeinstallprompt`
//  se dispara UNA sola vez en el navegador: si dos componentes lo escuchan por
//  su cuenta, uno se queda sin él. Acá lo capturamos en un único lugar y lo
//  exponemos a quien quiera ofrecer "Instalar" (el banner automático y el botón
//  persistente del login). Así cualquier superficie puede lanzar la instalación.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useSyncExternalStore } from "react";

type PromptInstalacion = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferido: PromptInstalacion | null = null;
let instalada = false;
let iniciado = false;
const oyentes = new Set<() => void>();

function emitir() {
  oyentes.forEach((f) => f());
}

/** ¿La app ya se abre como instalada (standalone)? */
function esStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari iOS expone navigator.standalone.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad con Safari (no dispara beforeinstallprompt → instrucción manual). */
export function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua);
}

/** Arranca la captura del evento de instalación. Idempotente (una sola vez). */
export function iniciarCapturaInstalacion(): void {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;
  instalada = esStandalone();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // evitamos el mini-infobar automático de Chrome
    deferido = e as PromptInstalacion;
    emitir();
  });
  window.addEventListener("appinstalled", () => {
    deferido = null;
    instalada = true;
    emitir();
  });
}

export type EstadoInstalacion =
  | "instalada" // ya está en el teléfono → no ofrecer
  | "listo" // Android/desktop: hay diálogo nativo listo para disparar
  | "ios" // iPhone: hay que guiar con "Compartir → Agregar a inicio"
  | "no-disponible"; // aún no elegible o navegador sin soporte

function estadoActual(): EstadoInstalacion {
  if (instalada || esStandalone()) return "instalada";
  if (deferido) return "listo";
  if (esIOS()) return "ios";
  return "no-disponible";
}

/** Dispara el diálogo nativo de instalación. Devuelve el resultado. */
export async function lanzarInstalacion(): Promise<"accepted" | "dismissed" | "no-disponible"> {
  if (!deferido) return "no-disponible";
  await deferido.prompt();
  const { outcome } = await deferido.userChoice;
  deferido = null;
  emitir();
  return outcome;
}

function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

/** Hook reactivo con el estado de instalación. Arranca la captura al montar. */
export function useInstalacion(): EstadoInstalacion {
  useEffect(() => {
    iniciarCapturaInstalacion();
  }, []);
  return useSyncExternalStore(suscribir, estadoActual, () => "no-disponible");
}

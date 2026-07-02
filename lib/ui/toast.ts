// ─────────────────────────────────────────────────────────────────────────
//  Toasts (avisos flotantes) — canal simple por eventos del navegador.
//  Cualquier componente cliente llama `notificar(...)` y el <Toaster/> montado
//  en el layout lo pinta. Sin librerías, mismo patrón que `aureo:preguntar`.
// ─────────────────────────────────────────────────────────────────────────
export type TipoToast = "info" | "exito" | "alerta" | "error";

export interface Toast {
  id: string;
  tipo: TipoToast;
  titulo?: string;
  mensaje: string;
  /** Si se pasa, tocar el toast navega a esta ruta interna. */
  href?: string;
  /** ms antes de auto-cerrar (0 = no se cierra solo). */
  duracion?: number;
}

export const EVENTO_TOAST = "py:toast";

/** Emite un toast. Seguro de llamar en cualquier componente cliente. */
export function notificar(t: Omit<Toast, "id"> & { id?: string }): void {
  if (typeof window === "undefined") return;
  const detalle: Toast = {
    id: t.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: t.tipo,
    titulo: t.titulo,
    mensaje: t.mensaje,
    href: t.href,
    duracion: t.duracion ?? 5000,
  };
  window.dispatchEvent(new CustomEvent<Toast>(EVENTO_TOAST, { detail: detalle }));
}

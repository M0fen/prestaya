// ─────────────────────────────────────────────────────────────────────────
//  PROTECCIÓN del almacenamiento — la ÚNICA defensa contra el desalojo.
//
//  La cola de cobros sin sincronizar vive en localStorage. El navegador/OS
//  puede DESALOJAR el storage del origen bajo presión de espacio (y iOS purga
//  el de una PWA sin uso a los ~7 días): un cobro guardado se evapora del
//  teléfono ANTES de subir, sin rastro local NI del servidor — pérdida total
//  silenciosa que ningún vigilante puede ver. `navigator.storage.persist()`
//  desactiva ese desalojo automático (Chrome lo concede solo a PWAs
//  instaladas, que es exactamente nuestro caso).
//
//  Nota de ingeniería honesta: esto NO se puede auto-detectar después (el
//  desalojo se lleva también cualquier contador local). Por eso la defensa es
//  PREVENTIVA y este módulo existe para que tenga test: un refactor que borre
//  la llamada dejaba la calle sin la única red, con toda la suite en verde.
// ─────────────────────────────────────────────────────────────────────────

type NavegadorConStorage = { storage?: { persist?: () => Promise<boolean> } };

/**
 * Pide almacenamiento persistente. Devuelve `true` (concedido), `false`
 * (denegado — el OS puede desalojar) o `null` (API no disponible / falló).
 * Best-effort: jamás lanza, jamás bloquea el arranque de la app.
 */
export async function protegerAlmacenamiento(
  nav: NavegadorConStorage = typeof navigator !== "undefined" ? navigator : {},
): Promise<boolean | null> {
  try {
    if (!nav.storage?.persist) return null;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}

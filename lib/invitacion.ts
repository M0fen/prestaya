// ─────────────────────────────────────────────────────────────────────────
//  INVITACIÓN al cartón — el mensaje con el que el cobrador da de alta al
//  cliente (WhatsApp / compartir).
//
//  Tono (regla del proyecto): el cartón se presenta como algo que el cliente
//  GANA —ver su progreso, su comprobante— no como un recordatorio de deuda.
//  Cortito: se lee de un vistazo en la calle, en el teléfono del cliente.
// ─────────────────────────────────────────────────────────────────────────

/** Primer nombre en formato amable ("MARÍA GONZÁLEZ" → "María"). Los nombres
 *  vienen en MAYÚSCULAS del sistema viejo; gritarle al cliente no es opción. */
export function nombreAmable(nombre: string | null | undefined): string {
  const base = (nombre ?? "").split(/[,(]/)[0].trim(); // saca apellidos tras coma y apodos
  const w = base.split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

/** Mensaje de invitación con el link personal del cliente. */
export function textoInvitacion(nombre: string | null | undefined, url: string): string {
  const n = nombreAmable(nombre);
  return [
    `¡Hola${n ? " " + n : ""}! 👋 Te comparto tu *cartón de pagos* de Presta Ya.`,
    "",
    "Desde tu teléfono, cuando quieras:",
    "✅ Ves lo que pagaste y lo que te falta",
    "✅ Tenés el comprobante de cada pago",
    "✅ Sabés cuál es tu cuota de hoy",
    "",
    "Este link es tuyo y personal 🔒",
    url,
    "",
    "Guardalo para tenerlo siempre a mano. 💙",
  ].join("\n");
}

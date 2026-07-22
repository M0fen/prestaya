// ─────────────────────────────────────────────────────────────────────────
//  TELÉFONO uruguayo → link de WhatsApp.
//  Regla única (antes estaba copiada en 3 pantallas): wa.me exige el número en
//  formato internacional SIN símbolos. Uruguay = 598, y el 0 inicial del
//  celular local (099…) NO va cuando se antepone el país.
// ─────────────────────────────────────────────────────────────────────────

/** Deja solo los dígitos (sirve para `tel:` y como base del resto). */
export function soloDigitos(tel: string | null | undefined): string {
  return (tel ?? "").replace(/\D/g, "");
}

/** Número listo para wa.me (con 598, sin el 0 local). "" si no hay teléfono. */
export function telWhatsApp(tel: string | null | undefined): string {
  const d = soloDigitos(tel);
  if (!d) return "";
  if (d.startsWith("598")) return d;
  return "598" + d.replace(/^0+/, "");
}

/**
 * Link de WhatsApp. Sin teléfono devuelve el link SIN destinatario: WhatsApp
 * abre el selector de contactos con el mensaje ya escrito (mejor que no poder
 * mandar nada cuando el cliente no tiene el número cargado).
 */
export function linkWhatsApp(tel: string | null | undefined, texto?: string): string {
  const destino = telWhatsApp(tel);
  const msg = texto ? `?text=${encodeURIComponent(texto)}` : "";
  return `https://wa.me/${destino}${msg}`;
}

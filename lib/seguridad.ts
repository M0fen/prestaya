// ─────────────────────────────────────────────────────────────────────────
//  Helpers de seguridad para datos que el ADMIN carga y se muestran al cliente.
//  El admin es de confianza, pero aplicamos defensa en profundidad: si un
//  enlace de anuncio (cta_url) trae un esquema peligroso (javascript:, data:…),
//  no lo dejamos llegar a un href. Una cuenta comprometida no debe poder
//  inyectar script en la vista del cliente.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la URL si es SEGURA para usar en un href; si no, null.
 * Permitidos: rutas relativas (/ruta, ./ruta, #ancla) y esquemas
 * http(s) / mailto / tel. Bloqueados: javascript:, data:, vbscript:,
 * protocolo-relativo (//host) y cualquier otro esquema.
 */
export function hrefSeguro(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (t === "") return null;

  // Rutas internas: ancla (#…), absoluta (/… pero no //…), o relativa (./…).
  if (/^(#|\/(?!\/)|\.\/)/.test(t)) return t;

  // Absolutas: solo esquemas inofensivos.
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;

  // Todo lo demás (javascript:, data:, vbscript:, //host, esquemas raros) → fuera.
  return null;
}

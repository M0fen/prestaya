// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — CIFRADO en reposo del chat interno (AES-256-GCM autenticado).
//  SOLO SERVIDOR (usa node:crypto y la clave secreta del entorno; nunca llega
//  al navegador). El cuerpo de cada mensaje se guarda cifrado: un dump de la
//  base o la service_role filtrada NO alcanzan para leerlo (hace falta también
//  CHAT_SECRET_KEY, que vive en el servidor). No es E2EE: el servidor (y por
//  ende la oficina) descifra para mostrar, que es justo lo que el negocio pide.
//
//  Formato del texto cifrado (versionado, para poder rotar el esquema):
//     v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
//  Los mensajes viejos en texto plano (sin prefijo v1:) se devuelven tal cual.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIJO = "v1";
const ALGO = "aes-256-gcm";

let claveCache: Buffer | null | undefined; // undefined = sin resolver, null = ausente

/** Resuelve la clave (32 bytes) desde CHAT_SECRET_KEY (base64). Cachea. */
function clave(): Buffer | null {
  if (claveCache !== undefined) return claveCache;
  const raw = process.env.CHAT_SECRET_KEY;
  if (!raw) {
    claveCache = null;
    return null;
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    buf = Buffer.alloc(0);
  }
  if (buf.length !== 32) {
    // Antes tiraba: eso tumbaba TODO el chat si la clave estaba mal. Ahora
    // degrada a "sin cifrado" (fail-open) y avisa una vez: la app no se cae.
    console.error(
      "[cripto] CHAT_SECRET_KEY inválida (debe ser 32 bytes en base64: `openssl rand -base64 32`). El chat sigue SIN cifrar.",
    );
    claveCache = null;
    return null;
  }
  claveCache = buf;
  return buf;
}

/** ¿Está activo el cifrado? (hay clave válida configurada). */
export function cifradoActivo(): boolean {
  return clave() !== null;
}

/** Cifra un texto. Si no hay clave configurada, devuelve el texto tal cual
 *  (fail-open para no romper el chat) y avisa una vez por proceso. */
let avisado = false;
export function cifrar(texto: string): string {
  const k = clave();
  if (!k) {
    if (!avisado) {
      console.warn(
        "[cripto] CHAT_SECRET_KEY no configurada: los mensajes se guardan SIN cifrar.",
      );
      avisado = true;
    }
    return texto;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIJO}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Descifra un texto. Los textos sin prefijo `v1:` (mensajes viejos en claro)
 *  se devuelven tal cual. Si el descifrado falla, devuelve un marcador en vez
 *  de romper la vista entera. */
export function descifrar(blob: string): string {
  if (!blob.startsWith(`${PREFIJO}:`)) return blob; // legado en texto plano
  const k = clave();
  if (!k) return "[mensaje cifrado]"; // había clave al cifrar, ya no
  try {
    const [, ivB64, tagB64, ctB64] = blob.split(":");
    const decipher = createDecipheriv(ALGO, k, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch {
    return "[mensaje ilegible]";
  }
}

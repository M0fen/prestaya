// ─────────────────────────────────────────────────────────────────────────
//  URL PÚBLICA de la app — para armar links que se COMPARTEN (QR, WhatsApp).
//
//  Un link que se le entrega a un cliente tiene que ser ABSOLUTO y estable en
//  el tiempo: si el cobrador entra por el dominio viejo de Vercel, el QR no
//  debe quedar clavado ahí. Por eso el orden es:
//    1) NEXT_PUBLIC_APP_URL  → dominio CANÓNICO (ej. https://app.prestaya.uy).
//    2) el host real del pedido (x-forwarded-host / host) → siempre funciona.
//  Así, cuando Carlos apunte el dominio propio, basta con setear la variable:
//  los links y QR nuevos salen con el dominio lindo sin tocar código.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { headers } from "next/headers";

/** Origen público (sin barra final). Ej: "https://app.prestaya.uy". */
export async function urlBase(): Promise<string> {
  const canonico = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (canonico) return canonico.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("No se pudo determinar el dominio de la app");
  // En local el host es http; en Vercel siempre llega x-forwarded-proto=https.
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Link PERSONAL del cartón de un cliente (el que se comparte / se hace QR). */
export async function urlCartonCliente(token: string): Promise<string> {
  return `${await urlBase()}/c/${encodeURIComponent(token)}`;
}

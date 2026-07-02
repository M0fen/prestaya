// ─────────────────────────────────────────────────────────────────────────
//  Cliente Supabase para el NAVEGADOR (clave anónima + sesión en cookies).
//  Respeta RLS con el usuario logueado. Se usa solo para SUSCRIPCIONES en vivo
//  (Realtime) del chat interno; toda escritura sigue yendo por Server Actions.
// ─────────────────────────────────────────────────────────────────────────
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

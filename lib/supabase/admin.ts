// ─────────────────────────────────────────────────────────────────────────
//  Cliente Supabase con la clave de SERVICIO (service_role).
//  ⚠️ PODER TOTAL: ignora RLS. Vive SOLO en el servidor.
//  El import "server-only" hace que el build falle si por error se importa
//  desde un componente de cliente (navegador).
//
//  Se usa en la vista de cliente por token: el servidor valida el token y
//  devuelve únicamente los datos de ese cliente; el navegador nunca habla
//  directo con Supabase.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan variables de entorno de Supabase (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

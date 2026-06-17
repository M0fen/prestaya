// ─────────────────────────────────────────────────────────────────────────
//  Cliente Supabase para el SERVIDOR con la clave ANÓNIMA.
//  Respeta Row Level Security (RLS) y lee/escribe la sesión en cookies.
//  Úsalo en contextos con usuario logueado (cobrador / admin).
//  Para la vista de cliente por token (sin login) se usa el cliente admin.
// ─────────────────────────────────────────────────────────────────────────
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // En Server Components no siempre se pueden escribir cookies;
          // se ignora el error y el middleware refresca la sesión.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* noop */
          }
        },
      },
    },
  );
}

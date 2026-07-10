// ─────────────────────────────────────────────────────────────────────────
//  Refresco de sesión + guardia de rutas internas (panel admin y app cobrador).
//  Patrón oficial de @supabase/ssr: en cada request a /admin o /cobrador se
//  refresca la sesión (cookies) y, si no hay usuario logueado, se redirige a
//  /ingresar. La vista de cliente (/, /c/…) NO pasa por acá (ver matcher en
//  middleware.ts). El rol se valida en cada layout (requireUsuario/Gestor).
// ─────────────────────────────────────────────────────────────────────────
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: no ejecutar lógica entre createServerClient y getUser().
  // getUser() puede LANZAR si el refresh del token falla (400 "Bad Request" con
  // token vencido/roto). Eso NO debe tumbar la request: se trata como sin sesión.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  // Rutas internas sin sesión → al login.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/ingresar";
    return NextResponse.redirect(url);
  }

  return response;
}

// ─────────────────────────────────────────────────────────────────────────
//  Refresco de sesión + guardia de rutas internas (panel admin y app cobrador).
//  Patrón oficial de @supabase/ssr: en cada request a /admin o /cobrador se
//  refresca la sesión (cookies) y, si no hay usuario logueado, se redirige a
//  /ingresar. La vista de cliente (/, /c/…) NO pasa por acá (ver matcher en
//  middleware.ts). El rol se valida en cada layout (requireUsuario/Gestor).
// ─────────────────────────────────────────────────────────────────────────
import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { reportarError } from "@/lib/observabilidad";

/** ¿Hay cookie de sesión de Supabase? (nombre `sb-…-auth-token`). Sin ella no hay
 *  sesión que preservar → un fallo se trata como "sin sesión" (login), no como blip. */
function tieneCookieSesion(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
}

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
  // getUser() puede fallar por (a) token INVÁLIDO (4xx → deslogueado real) o (b) un
  // BLIP TRANSITORIO de Auth (red/5xx/timeout/cold-start). No hay que botar a TODOS
  // (cobradores mid-ruta) por un blip: si el error es "retryable" y HAY cookie de
  // sesión, se deja pasar la request (fail-open de DISPONIBILIDAD). El RLS y
  // requireUsuario siguen siendo el gate real, y el JWT se valida por FIRMA en cada
  // consulta a la DB — no depende de que Auth esté arriba en este instante.
  let user = null;
  let transitorio = false;
  let errObs: unknown = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    if (!user && error && isAuthRetryableFetchError(error)) {
      transitorio = true;
      errObs = error;
    }
  } catch (e) {
    user = null;
    if (isAuthRetryableFetchError(e)) {
      transitorio = true;
      errObs = e;
    }
  }

  if (!user) {
    // Blip transitorio + hay sesión previa → NO desloguear (conservar disponibilidad).
    if (transitorio && tieneCookieSesion(request)) {
      reportarError("middleware.authBlip", errObs, { path: request.nextUrl.pathname });
      return response;
    }
    // Sin sesión real (token inválido / sin cookie) → al login.
    const url = request.nextUrl.clone();
    url.pathname = "/ingresar";
    return NextResponse.redirect(url);
  }

  return response;
}

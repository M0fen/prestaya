// Paso de verificación 2FA (step-up). Fuera del layout del panel para evitar
// bucles de redirección. Si el usuario no tiene 2FA pendiente, lo manda a su
// inicio. Recupera el destino de ?to= (validado a una ruta interna).
import { redirect } from "next/navigation";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { estadoMfa } from "@/lib/seguridad/mfa";
import { DesafioMfa } from "@/components/auth/DesafioMfa";

export const dynamic = "force-dynamic";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) redirect("/ingresar");

  const db = await createSupabaseServer();
  const mfa = await estadoMfa(db);
  // Si ya está en aal2 (o no tiene 2FA), no hay nada que verificar.
  if (!mfa.stepUpPendiente) redirect(rutaHome(usuario.rol));

  const { to } = await searchParams;
  // Solo rutas internas (evita open-redirect).
  const destino = to && /^\/[A-Za-z0-9/_-]*$/.test(to) ? to : rutaHome(usuario.rol);

  return <DesafioMfa destino={destino} />;
}

// Entrada de Presta Ya. La raíz NO muestra nada propio: es solo el punto de
// acceso profesional. Según la sesión, deriva a donde corresponde —
//   · con sesión activa → su inicio (panel del gestor o ruta del cobrador),
//   · sin sesión        → la pantalla de ingreso.
// El demo del producto vive en /demo; la vista del cliente en /c/[token].
import { redirect } from "next/navigation";
import { getUsuarioActual, rutaHome } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await getUsuarioActual();
  if (u && u.activo) redirect(rutaHome(u.rol));
  redirect("/ingresar");
}

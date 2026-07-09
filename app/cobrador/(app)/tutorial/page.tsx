// Tutorial in-app (app del cobrador). Muestra solo las guías del cobrador
// (el acceso lo resuelve guiasPara según el rol). Mobile-first.
import { requireUsuario } from "@/lib/auth";
import { guiasPara, rolesVisiblesPara } from "@/lib/tutorial/contenido";
import { Tutorial } from "@/components/tutorial/Tutorial";

export const dynamic = "force-dynamic";

export default async function TutorialCobradorPage() {
  const usuario = await requireUsuario();
  const guias = guiasPara(usuario.rol);
  const roles = rolesVisiblesPara(usuario.rol);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[19px] font-extrabold text-tinta">Cómo se usa</h1>
        <span className="text-[13px] font-medium text-gris">
          Guía rápida para tu día a día. Tocá cada tarjeta para ver los pasos.
        </span>
      </div>
      <Tutorial guias={guias} roles={roles} base="/cobrador" />
    </div>
  );
}

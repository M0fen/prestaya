// Tutorial in-app (panel). El acceso lo define el rol: el admin ve las guías de
// los tres roles; el supervisor ve cobrador + supervisor. Contenido y reglas de
// visibilidad viven en lib/tutorial/contenido.ts (núcleo puro, testeado).
import { requireGestor, etiquetaRol } from "@/lib/auth";
import { guiasPara, rolesVisiblesPara } from "@/lib/tutorial/contenido";
import { Tutorial } from "@/components/tutorial/Tutorial";

export const dynamic = "force-dynamic";

export default async function TutorialPanelPage() {
  const usuario = await requireGestor();
  const guias = guiasPara(usuario.rol);
  const roles = rolesVisiblesPara(usuario.rol);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Cómo se usa</h1>
        <span className="text-[13px] font-medium text-gris">
          Guía paso a paso de Presta Ya. Como {etiquetaRol[usuario.rol].toLowerCase()}, ves las guías
          de {roles.length > 1 ? "los roles a tu cargo y el tuyo" : "tu rol"}. Tocá cada tarjeta para
          abrirla.
        </span>
      </div>

      <Tutorial guias={guias} roles={roles} />
    </div>
  );
}

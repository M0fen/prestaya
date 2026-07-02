// Pantalla de ingreso del equipo. Si ya hay sesión, redirige a su inicio.
import { redirect } from "next/navigation";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
import { FormIngreso } from "@/components/auth/FormIngreso";

export const dynamic = "force-dynamic";

export default async function IngresarPage() {
  const usuario = await getUsuarioActual();
  if (usuario && usuario.activo) redirect(rutaHome(usuario.rol));

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F1B3D] px-5">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[20px] font-black text-white">
            P
          </div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-white">
            Presta Ya
          </h1>
          <p className="text-[13px] font-medium text-white/55">
            Acceso del equipo. Ingresá con tu cuenta.
          </p>
        </div>

        <FormIngreso />

        <p className="mt-4 text-center text-[11px] font-medium text-white/40">
          Conexión segura · acceso restringido al personal autorizado
        </p>
      </div>
    </div>
  );
}

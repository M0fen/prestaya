// Pantalla de ingreso del equipo. Si ya hay sesión, redirige a su inicio.
import { redirect } from "next/navigation";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
import { FormIngreso } from "@/components/auth/FormIngreso";

export const dynamic = "force-dynamic";

export default async function IngresarPage() {
  const usuario = await getUsuarioActual();
  if (usuario && usuario.activo) redirect(rutaHome(usuario.rol));

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#0B1636] px-5 py-10">
      {/* Fondo con profundidad de marca (radial azul rey + halo suave). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#2453DC_0%,#16307f_42%,#0B1636_78%)]" />
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#3a6bff]/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[400px]">
        {/* Marca */}
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[linear-gradient(140deg,#3a6bff,#1E47C8_55%,#13308C)] text-[24px] font-black text-white shadow-[0_12px_30px_rgba(20,50,150,0.55),inset_0_1px_0_rgba(255,255,255,0.25)]">
            P
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-[25px] font-extrabold tracking-[-0.02em] text-white">Presta Ya</h1>
            <p className="text-[13px] font-medium text-white/60">
              Panel del equipo · créditos y cobranza
            </p>
          </div>
        </div>

        <FormIngreso />

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-white/45">
          <span aria-hidden="true">🔒</span>
          Conexión segura · acceso restringido al personal autorizado
        </p>
      </div>
    </main>
  );
}

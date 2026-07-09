// Seguridad de la cuenta: activar/desactivar 2FA propio. El admin además puede
// resetear el 2FA de otro usuario (recuperación si perdió el teléfono).
import { requireUsuario, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Gestion2FA } from "@/components/admin/Gestion2FA";
import { ResetMfaBtn } from "@/components/admin/ResetMfaBtn";
import type { Rol } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function SeguridadPage() {
  const usuario = await requireUsuario();
  const admin = esAdmin(usuario.rol);

  // Para el reseteo: los demás gestores (solo lo ve/usa el admin).
  let otros: { id: string; nombre: string; rol: Rol }[] = [];
  if (admin) {
    const db = await createSupabaseServer();
    const { data } = await db
      .from("usuarios")
      .select("id, nombre, rol")
      .in("rol", ["admin", "supervisor"])
      .eq("activo", true)
      .neq("id", usuario.id)
      .order("nombre");
    otros = (data ?? []) as { id: string; nombre: string; rol: Rol }[];
  }

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Seguridad</h1>
        <span className="text-[13px] font-medium text-gris">
          Verificación en dos pasos (2FA) de tu cuenta. Muy recomendada para el administrador.
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Tu 2FA</span>
        <Gestion2FA />
      </section>

      {admin && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Recuperación (resetear el 2FA de otro)
          </span>
          <p className="text-[12px] font-medium text-gris">
            Si alguien pierde el teléfono, reseteale el 2FA acá. Vuelve a entrar con su contraseña y
            lo activa de nuevo. (Respaldo: el panel de Supabase.)
          </p>
          <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {otros.length === 0 && (
              <li className="px-4 py-3 text-[12.5px] font-medium text-gris">No hay otros gestores.</li>
            )}
            {otros.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13.5px] font-bold text-tinta">{o.nombre}</span>
                <ResetMfaBtn usuarioId={o.id} nombre={o.nombre} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

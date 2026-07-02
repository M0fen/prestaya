// Notas personales (privadas) del usuario del panel.
import { requireUsuario } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getNotasPersonales } from "@/lib/data/notas";
import { NotasPersonales } from "@/components/notas/NotasPersonales";

export const dynamic = "force-dynamic";

export default async function NotasAdminPage() {
  await requireUsuario();
  const db = await createSupabaseServer();
  const notas = await getNotasPersonales(db);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Mis notas</h1>
        <span className="text-[13px] font-medium text-gris">Privadas: solo las ves vos.</span>
      </div>
      <NotasPersonales notas={notas} />
    </div>
  );
}

// Bandeja de anulaciones de pago (gestores). El supervisor solicita anular un
// pago de su zona; acá una SEGUNDA persona (admin u otro gestor distinto)
// confirma o rechaza. Doble registro anti-fraude sobre el dinero.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSolicitudesPendientes } from "@/lib/data/anulaciones";
import { SolicitudesAnulacion } from "@/components/admin/SolicitudesAnulacion";

export const dynamic = "force-dynamic";

export default async function AnulacionesPage() {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const solicitudes = await getSolicitudesPendientes(db);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Anulaciones</h1>
        <span className="text-[13px] font-medium text-gris">
          Pedidos de anular pagos. Los confirma una segunda persona (no quien los pidió): doble
          registro sobre el dinero. El pago se marca anulado, nunca se borra.
        </span>
      </div>

      <SolicitudesAnulacion solicitudes={solicitudes} yoId={usuario.id} />
    </div>
  );
}

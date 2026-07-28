// Recibos a trabajadores (solo admin): emite comprobantes de pago (comisión,
// sueldo, adelanto…), numerados e imprimibles. No es factura fiscal (DGI).
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRecibos } from "@/lib/data/recibos";
import { RecibosManager } from "@/components/admin/RecibosManager";
import { NEGOCIO } from "@/lib/negocio";

export const dynamic = "force-dynamic";

export default async function RecibosPage() {
  await requireAdmin();
  const db = await createSupabaseServer();

  const [{ data: us }, recibos] = await Promise.all([
    db
      .from("usuarios")
      .select("id, nombre, documento")
      .in("rol", ["cobrador", "supervisor"])
      .eq("activo", true)
      .order("nombre"),
    getRecibos(db),
  ]);
  const trabajadores = (us ?? []).map((u) => ({
    id: u.id as string,
    nombre: u.nombre as string,
    documento: (u.documento as string | null) ?? null,
  }));

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5 print:hidden">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Recibos</h1>
        <span className="text-[13px] font-medium text-gris">
          Emití un comprobante de pago a un trabajador (comisión, sueldo, adelanto…). Queda numerado,
          guardado e imprimible.
        </span>
      </div>

      <RecibosManager trabajadores={trabajadores} recibos={recibos} negocio={NEGOCIO} />

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2 print:hidden">
        Es un comprobante interno de pago, no una factura fiscal (eso lo regula la DGI). Requiere la
        migración 0046.
      </p>
    </div>
  );
}

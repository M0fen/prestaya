// Control de campo (admin/supervisor): auditoría hiper-blindada del cobrador.
// Cada acción queda con GPS + hora de servidor (inmutable). Acá el gestor ve, por
// día, el score de sospecha de cada cobrador (planchado, fuera de zona, sin
// moverse, GPS apagado) y el detalle de sus acciones en un mapa.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenBitacoraDia } from "@/lib/data/bitacora";
import { fechaISOUY } from "@/lib/fecha";
import { ControlCampo } from "@/components/admin/ControlCampo";

export const dynamic = "force-dynamic";

export default async function CampoPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  await requireGestor();
  const db = await createSupabaseServer();
  const hoy = fechaISOUY();
  const pedida = (await searchParams).fecha;
  const fecha = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hoy;
  const resumen = await getResumenBitacoraDia(db, fecha);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Control de campo</h1>
        <span className="text-[13px] font-medium text-gris">
          Cada acción del cobrador queda con GPS y hora del servidor (inmutable). El score marca
          posibles “mañas”: planchado, cobros fuera de zona, sin moverse, GPS apagado.
        </span>
      </div>

      {/* Selector de día (form GET, sin JS) */}
      <form method="get" className="flex items-center gap-2">
        <input
          type="date"
          name="fecha"
          defaultValue={fecha}
          max={hoy}
          className="rounded-[10px] border border-borde px-3 py-2 text-[13px] text-tinta outline-none focus:border-azul"
        />
        <button
          type="submit"
          className="rounded-full bg-azul px-4 py-2 text-[13px] font-bold text-white"
        >
          Ver
        </button>
        {fecha === hoy && (
          <span className="text-[12px] font-semibold text-gris">Hoy</span>
        )}
      </form>

      <ControlCampo resumen={resumen} />

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        La bitácora es inmutable (solo se agrega, no se edita ni borra). El cobrador está informado
        de que sus acciones quedan geolocalizadas.
      </p>
    </div>
  );
}

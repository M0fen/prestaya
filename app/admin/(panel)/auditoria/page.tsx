// Auditoría (gestor): log inmutable de quién hizo qué y cuándo en el panel.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAuditoria } from "@/lib/data/auditoria";
import { horaDe, meses } from "@/lib/format";

export const dynamic = "force-dynamic";

// Ícono por tipo de acción (heurística por palabra clave).
function iconoDe(accion: string): string {
  const a = accion.toLowerCase();
  if (a.includes("renov")) return "🔄";
  if (a.includes("caja") || a.includes("comisión") || a.includes("liquid")) return "💵";
  if (a.includes("jornada")) return "🧾";
  if (a.includes("chat")) return "💬";
  if (a.includes("gaming")) return "🎮";
  return "•";
}

function cuando(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
  return mismoDia
    ? `Hoy ${horaDe(iso)}`
    : `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${horaDe(iso)}`;
}

export default async function AuditoriaPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const registros = await getAuditoria(db, 150);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Auditoría</h1>
        <span className="text-[13px] font-medium text-gris">
          Registro inmutable: quién hizo qué y cuándo. Últimas {registros.length} acciones.
        </span>
      </div>

      {registros.length === 0 ? (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
          Todavía no hay acciones registradas.
          <br />
          <span className="text-[12px] text-[#AEB6CC]">
            Las renovaciones, movimientos de caja, cierres de jornada y demás aparecerán acá.
          </span>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
          {registros.map((r) => (
            <li key={r.id} className="flex items-start gap-3 p-3.5">
              <span className="mt-0.5 text-[16px]">{iconoDe(r.accion)}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-bold text-tinta">
                  {r.accion}
                  {r.detalle && <span className="font-medium text-gris"> — {r.detalle}</span>}
                </span>
                <span className="text-[11.5px] font-medium text-tenue">
                  {r.actorNombre} · {cuando(r.creadoEn)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

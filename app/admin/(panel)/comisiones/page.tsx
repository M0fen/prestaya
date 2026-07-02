// Comisiones por cobrador (gestor): tasa % sobre lo recaudado del período, con
// liquidación (egreso en caja) y auditoría. Selector Día/Semana/Mes/Año.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getComisionesPeriodo } from "@/lib/data/comisiones";
import { normalizarPeriodo, PERIODOS } from "@/lib/data/periodo";
import { TablaComisiones } from "@/components/admin/TablaComisiones";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireGestor();
  const periodo = normalizarPeriodo((await searchParams).periodo);
  const db = await createSupabaseServer();
  const r = await getComisionesPeriodo(db, periodo);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Comisiones</h1>
          <span className="text-[13px] font-medium text-gris">
            {r.etiqueta} · % sobre lo recaudado por cada cobrador.
          </span>
        </div>
        <div className="flex rounded-full bg-[#F0F3FA] p-0.5">
          {PERIODOS.map((p) => {
            const activo = p.id === periodo;
            return (
              <Link
                key={p.id}
                href={p.id === "dia" ? "/admin/comisiones" : `/admin/comisiones?periodo=${p.id}`}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                  activo ? "bg-white text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      {!r.disponible && (
        <p className="rounded-[12px] bg-[#FEF9EE] px-3.5 py-2.5 text-[12.5px] font-medium text-[#B7791F]">
          Para fijar comisiones, corré la migración{" "}
          <code className="rounded bg-white px-1 font-mono text-[11.5px]">0014_comisiones.sql</code>. Mientras
          tanto la tasa queda en 0%.
        </p>
      )}

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#E6EAF4] bg-white p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Recaudado</span>
          <span className="text-[21px] font-extrabold tabular-nums text-tinta">{UYU(r.totalRecaudado)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#E6EAF4] bg-white p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Comisiones</span>
          <span className="text-[21px] font-extrabold tabular-nums text-verde">{UYU(r.totalComision)}</span>
        </div>
      </div>

      <TablaComisiones filas={r.filas} etiqueta={r.etiqueta} />

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Liquidar registra un egreso en la Caja (categoría “Comisión”) y queda en la auditoría. La
        comisión se calcula sobre lo recaudado por cada cobrador en el período elegido.
      </p>
    </div>
  );
}

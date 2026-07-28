// Comisiones por cobrador (gestor): tasa % sobre lo recaudado del período, con
// liquidación (egreso en caja) y auditoría. Selector Día/Semana/Mes/Año.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getComisionesPeriodo, getHistorialLiquidaciones, etiquetaPeriodoKey } from "@/lib/data/comisiones";
import { normalizarPeriodo, PERIODOS } from "@/lib/data/periodo";
import { TablaComisiones } from "@/components/admin/TablaComisiones";
import { conTimeout } from "@/lib/timeout";
import { UYU, meses } from "@/lib/format";

// Un agregado colgado LANZA → error.tsx del panel ("Reintentar"), no un 504.
const TOPE_MS = 22_000;

// "YYYY-MM-DD" → "5 jul" (día UY, legible).
function fCorta(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${(meses[Number(m) - 1] ?? "").slice(0, 3)}`;
}

// timestamptz → "9 jul, 20:30" (hora Uruguay).
function fHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const dynamic = "force-dynamic";

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  // Gestores: el supervisor VE las comisiones de los cobradores; FIJAR la tasa y
  // LIQUIDAR (egreso de caja) queda para el admin (las acciones exigen esAdmin en
  // el server, y la tabla oculta esos botones si no es admin — ver puedeGestionar).
  const usuario = await requireGestor();
  const periodo = normalizarPeriodo((await searchParams).periodo);
  const db = await createSupabaseServer();
  const [r, historial] = await conTimeout(
    Promise.all([getComisionesPeriodo(db, periodo), getHistorialLiquidaciones(db)]),
    TOPE_MS,
    "admin.comisiones",
  );
  const puedeGestionar = esAdmin(usuario.rol);
  // "A liquidar" = solo lo PENDIENTE (los ya liquidados no se vuelven a pagar).
  const aLiquidar = r.filas.filter((f) => !f.liquidado).reduce((s, f) => s + f.comision, 0);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Comisiones</h1>
          <span className="text-[13px] font-medium text-gris">
            {r.etiqueta} · del <b className="text-cuerpo">{fCorta(r.desde)}</b> al{" "}
            <b className="text-cuerpo">{fCorta(r.hasta)}</b> · {r.totalCobros} cobro(s).
          </span>
        </div>
        <div className="flex rounded-full bg-suave p-0.5">
          {PERIODOS.map((p) => {
            const activo = p.id === periodo;
            return (
              <Link
                key={p.id}
                href={p.id === "dia" ? "/admin/comisiones" : `/admin/comisiones?periodo=${p.id}`}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                  activo ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      {!r.disponible && (
        <p className="rounded-[12px] bg-ambar-suave px-3.5 py-2.5 text-[12.5px] font-medium text-ambar-osc">
          Para fijar comisiones, corré la migración{" "}
          <code className="rounded bg-tarjeta px-1 font-mono text-[11.5px]">0014_comisiones.sql</code>. Mientras
          tanto la tasa queda en 0%.
        </p>
      )}

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Recaudado</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{UYU(r.totalRecaudado)}</span>
          <span className="text-[11px] font-medium text-tenue">del período</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Cobros</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{r.totalCobros}</span>
          <span className="text-[11px] font-medium text-tenue">
            ticket {UYU(r.totalCobros > 0 ? Math.round(r.totalRecaudado / r.totalCobros) : 0)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Cobradores</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{r.filas.length}</span>
          <span className="text-[11px] font-medium text-tenue">
            {r.filas.filter((f) => f.recaudado > 0).length} con cobros
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#DCE6FB] bg-azul-suave p-4">
          <span className="text-[11px] font-bold tracking-wide text-azul uppercase">A liquidar</span>
          <span className="text-[19px] font-extrabold tabular-nums text-verde">{UYU(aLiquidar)}</span>
          <span className="text-[11px] font-medium text-tenue">
            {r.totalLiquidado > 0 ? `${UYU(r.totalLiquidado)} ya liquidado` : "pendiente del período"}
          </span>
        </div>
      </div>

      <TablaComisiones
        filas={r.filas}
        etiqueta={r.etiqueta}
        periodoKey={r.periodoKey}
        totalRecaudado={r.totalRecaudado}
        puedeGestionar={puedeGestionar}
      />

      {!puedeGestionar && (
        <p className="rounded-[12px] bg-suave px-3.5 py-2.5 text-[12px] font-medium text-gris">
          Estás como supervisor: podés ver las comisiones, pero fijarlas y liquidarlas queda para el administrador.
        </p>
      )}

      {/* Historial de liquidaciones (auditoría legible de lo ya pagado) */}
      {historial.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.03em] text-gris">
            Historial de liquidaciones ({historial.length})
          </span>
          <div className="overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            <ul className="flex flex-col divide-y divide-linea">
              {historial.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold text-tinta">{l.cobradorNombre}</span>
                    <span className="text-[11px] font-medium text-tenue">
                      {etiquetaPeriodoKey(l.periodoKey)}
                      {l.liquidadoPorNombre ? ` · por ${l.liquidadoPorNombre}` : ""} · {fHora(l.liquidadoEn)}
                    </span>
                  </div>
                  <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-verde">
                    {UYU(l.monto)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        La comisión se calcula sobre lo <b>recaudado</b> por cada cobrador en el período. <b>Liquidar</b> registra
        un egreso en la Caja (categoría “Comisión”) y queda en la auditoría — <b>una sola vez por período</b> (si ya
        se liquidó, el botón queda deshabilitado; no se paga dos veces). Los <b>faltantes NO se descuentan acá</b>:
        van a la cuenta corriente y al score de confianza del cobrador (Centro de alertas), que es donde se decide
        cómo recuperarlos.
      </p>
    </div>
  );
}

// Desempeño por rango (admin/supervisor) — HISTORIAL del rendimiento de los
// cobradores entre dos fechas: recaudado, cobros, días activos y (si hay
// rendiciones) entregado/faltantes. Del libro de pagos inmutable, acotado por
// zona (el supervisor ve la suya). SOLO LECTURA.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getDesempenoRango, MAX_DIAS_DESEMPENO } from "@/lib/data/desempeno";
import { alcanceDelActor } from "@/lib/data/alcance";
import { fechaISOUY, sumarDiasYmd } from "@/lib/fecha";
import { UYU, meses } from "@/lib/format";
import { Columnas } from "@/components/charts/Columnas";
import { BotonImprimir } from "@/components/admin/BotonImprimir";

export const dynamic = "force-dynamic";

const esYmd = (v: string | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

/** "YYYY-MM-DD" → "9 jul". */
function diaCorto(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${(meses[m - 1] ?? "").slice(0, 3)}`;
}

export default async function DesempenoPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const alcance = await alcanceDelActor();
  const sp = await searchParams;

  const hoyYmd = fechaISOUY();
  // Default: últimos 7 días (incluye hoy).
  const desde = esYmd(sp.desde) ?? sumarDiasYmd(hoyYmd, -6);
  const hasta = esYmd(sp.hasta) ?? hoyYmd;

  const r = await getDesempenoRango(db, { desde, hasta }, alcance);

  // Chips de rango rápido (GET, sin JS).
  const primerDelMes = `${hoyYmd.slice(0, 7)}-01`;
  const chips: { label: string; desde: string; hasta: string }[] = [
    { label: "Hoy", desde: hoyYmd, hasta: hoyYmd },
    { label: "7 días", desde: sumarDiasYmd(hoyYmd, -6), hasta: hoyYmd },
    { label: "30 días", desde: sumarDiasYmd(hoyYmd, -29), hasta: hoyYmd },
    { label: "Este mes", desde: primerDelMes, hasta: hoyYmd },
  ];

  const esAdmin = usuario.rol === "admin";
  const csvHref = `/api/reportes/desempeno?desde=${r.desde}&hasta=${r.hasta}`;

  const entregado = r.cobradores.reduce((s, c) => s + c.entregado, 0);
  const faltantes = r.cobradores.reduce((s, c) => s + c.faltantes, 0);
  const cols = r.serie.map((s) => ({
    etiqueta: diaCorto(s.fecha),
    valor: s.recaudado,
    esHoy: s.fecha === hoyYmd,
    tooltip: `${diaCorto(s.fecha)}: ${UYU(s.recaudado)} en ${s.cobros} cobros`,
  }));

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Desempeño</h1>
          <span className="text-[13px] font-medium text-gris">
            Historial de cobradores por rango de fechas. Del libro de pagos inmutable.
          </span>
        </div>
        <div className="flex gap-2 print:hidden">
          {esAdmin && (
            <a
              href={csvHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-azul hover:bg-suave"
            >
              ⬇️ Exportar CSV
            </a>
          )}
          <BotonImprimir />
        </div>
      </div>

      {/* Rango + chips (GET, sin JS) */}
      <div className="flex flex-col gap-2.5 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-[16px] border border-borde bg-tarjeta p-3.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gris">Desde</span>
            <input type="date" name="desde" defaultValue={r.desde} max={hoyYmd} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gris">Hasta</span>
            <input type="date" name="hasta" defaultValue={r.hasta} max={hoyYmd} className={INPUT} />
          </label>
          <button type="submit" className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white">
            Aplicar
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const activo = c.desde === r.desde && c.hasta === r.hasta;
            return (
              <Link
                key={c.label}
                href={`/admin/desempeno?desde=${c.desde}&hasta=${c.hasta}`}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-bold ${
                  activo ? "acto-activo border-azul text-azul" : "border-borde bg-tarjeta text-gris hover:bg-suave"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      </div>

      {r.recortado && (
        <p className="rounded-[12px] border border-[#F0D9A8] panel-ambar px-3.5 py-2.5 text-[12px] font-semibold text-[#9A6A0E]">
          El rango pedido superaba {MAX_DIAS_DESEMPENO} días y se acotó a {r.desde} → {r.hasta}.
        </p>
      )}

      {/* KPIs del rango */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Recaudado" valor={UYU(r.totalRecaudado)} tono="#157A50" />
        <Kpi label="Cobros" valor={String(r.totalCobros)} />
        <Kpi label="Cobradores activos" valor={String(r.cobradoresActivos)} />
        <Kpi
          label={r.disponibleRendiciones ? "Entregado" : "Faltantes"}
          valor={r.disponibleRendiciones ? UYU(entregado) : String(faltantes)}
          tono={r.disponibleRendiciones ? "#1E47C8" : faltantes > 0 ? "#C0392B" : undefined}
        />
      </div>

      {/* Serie diaria */}
      {cols.length > 1 && (
        <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
          <span className="text-[13.5px] font-extrabold text-tinta">Recaudo por día</span>
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(280, cols.length * 16) }}>
              <Columnas datos={cols} color="#1FA971" colorHoy="#13308C" />
            </div>
          </div>
        </section>
      )}

      {/* Ranking de cobradores */}
      <section className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="text-[13.5px] font-extrabold text-tinta">Cobradores en el rango</span>
          <span className="text-[11.5px] font-medium text-tenue">
            {r.desde} → {r.hasta} · {r.dias} día{r.dias === 1 ? "" : "s"}
          </span>
        </div>
        {r.cobradores.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] font-medium text-gris">
            Sin cobros de cobradores en el rango.
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-3 py-2.5 text-left">#</th>
                <th className="px-3 py-2.5 text-left">Cobrador</th>
                <th className="px-3 py-2.5 text-left">Zona</th>
                <th className="px-3 py-2.5 text-right">Recaudado</th>
                <th className="px-3 py-2.5 text-right">Cobros</th>
                <th className="px-3 py-2.5 text-right">Días</th>
                {r.disponibleRendiciones && <th className="px-3 py-2.5 text-right">Entregado</th>}
                {r.disponibleRendiciones && <th className="px-3 py-2.5 text-right">Faltantes</th>}
              </tr>
            </thead>
            <tbody>
              {r.cobradores.map((c, i) => (
                <tr key={c.cobradorId} className="border-b border-linea">
                  <td className="px-3 py-2.5 font-black text-tenue tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link href="/admin/campo" className="font-bold text-tinta hover:text-azul">
                        {c.nombre}
                      </Link>
                      <Link
                        href={`/admin/chat?c=cob:${c.cobradorId}`}
                        className="text-[13px] leading-none hover:opacity-70"
                        title={`Mensaje a ${c.nombre}`}
                        aria-label={`Mensaje a ${c.nombre}`}
                      >
                        💬
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gris">{c.zonaNombre ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-[#157A50]">{UYU(c.recaudado)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-cuerpo">{c.cobros}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-cuerpo">{c.diasActivos}</td>
                  {r.disponibleRendiciones && (
                    <td className="px-3 py-2.5 text-right tabular-nums text-cuerpo">{UYU(c.entregado)}</td>
                  )}
                  {r.disponibleRendiciones && (
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.faltantes > 0 ? (
                        <span className="font-bold text-[#C0392B]">
                          {c.faltantes} · {UYU(c.montoFaltante)}
                        </span>
                      ) : (
                        <span className="text-tenue">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Por zona */}
      {r.porZona.length > 1 && (
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
          <span className="text-[13.5px] font-extrabold text-tinta">Por zona</span>
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {r.porZona.map((z) => (
              <li key={z.zonaNombre} className="flex items-center justify-between py-2">
                <span className="text-[13px] font-semibold text-tinta">{z.zonaNombre}</span>
                <span className="text-[12px] font-medium text-gris">{z.cobros} cobros</span>
                <span className="text-[13.5px] font-extrabold text-tinta tabular-nums">{UYU(z.recaudado)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] leading-[1.5] font-medium text-tenue">
        El recaudado es la suma de los cobros que registró cada cobrador en el rango (libro de pagos inmutable).
        {r.disponibleRendiciones
          ? " Entregado/Faltantes salen de las rendiciones de jornada de esos días."
          : ""}
      </p>
    </div>
  );
}

const INPUT =
  "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] text-tinta outline-none focus:border-azul";

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[20px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {valor}
      </span>
    </div>
  );
}

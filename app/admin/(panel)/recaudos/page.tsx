// Recaudos (pagos del día) — réplica de "Recaudos Diario · Pagos de Créditos"
// de Disapp. SOLO LECTURA. Totales + tabla filtrable por rango, vendedor y texto.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRecaudos } from "@/lib/data/recaudos";
import { getVendedores } from "@/lib/data/usuarios";
import { getEstadisticas } from "@/lib/data/estadisticas";
import { diaUYInicioIso, diaUYFinIso, fechaISOUY } from "@/lib/fecha";
import { BotonImprimir } from "@/components/admin/BotonImprimir";
import { Columnas } from "@/components/charts/Columnas";
import { UYU, horaDe, meses } from "@/lib/format";

export const dynamic = "force-dynamic";

function mesLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(meses[m - 1] ?? "").slice(0, 3)} ${String(y).slice(2)}`;
}

const esYmd = (v: string | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—"; // fecha ausente → guion, no "Invalid Date"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha inválida → guion
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${horaDe(iso)}`;
}

export default async function RecaudosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; vendedor?: string; q?: string }>;
}) {
  const sp = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();

  const hoyYmd = fechaISOUY();
  const desde = esYmd(sp.desde) ?? hoyYmd;
  const hasta = esYmd(sp.hasta) ?? hoyYmd;
  const vendedorId = sp.vendedor || null;
  const q = (sp.q ?? "").trim() || null;

  const [r, vendedores, stats] = await Promise.all([
    getRecaudos(db, {
      desde: diaUYInicioIso(desde),
      hasta: diaUYFinIso(hasta),
      vendedorId,
      q,
    }),
    getVendedores(db),
    getEstadisticas(db, { meses: 8 }),
  ]);

  // Rendimiento mensual: recaudo por mes + calificación del mes en curso vs el
  // promedio de los meses previos (con caveat de que el mes actual es parcial).
  const serieMes = stats.disponible ? stats.mensual : [];
  const ultMes = serieMes.length - 1;
  const mesActual = serieMes[ultMes];
  const previos = serieMes.slice(0, ultMes);
  const promPrevio = previos.length
    ? previos.reduce((s, m) => s + m.recaudado, 0) / previos.length
    : 0;
  const vsProm = promPrevio > 0 && mesActual ? Math.round((mesActual.recaudado / promPrevio - 1) * 100) : null;
  const calif =
    vsProm == null
      ? { label: "—", color: "#6B7494" }
      : vsProm >= 10
        ? { label: "Excelente", color: "#157A50" }
        : vsProm >= -8
          ? { label: "En línea", color: "#1E47C8" }
          : vsProm >= -25
            ? { label: "Bajo", color: "#B9770E" }
            : { label: "Muy bajo", color: "#C0392B" };
  const colsMes = serieMes.map((m, i) => ({
    etiqueta: mesLabel(m.mes),
    valor: m.recaudado,
    esHoy: i === ultMes,
    tooltip: `${mesLabel(m.mes)}: ${UYU(m.recaudado)} en ${m.cobros} cobros`,
  }));

  // Link de exportación con los mismos filtros aplicados.
  const qs = new URLSearchParams();
  qs.set("desde", desde);
  qs.set("hasta", hasta);
  if (vendedorId) qs.set("vendedor", vendedorId);
  if (q) qs.set("q", q);
  const csvHref = `/api/reportes/recaudos?${qs.toString()}`;

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Recaudos</h1>
          <span className="text-[13px] font-medium text-gris">
            Pagos de créditos del período. Los cobros entran desde la calle (inmutables).
          </span>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-[#2453DC] hover:bg-suave"
          >
            ⬇️ Exportar CSV
          </a>
          <BotonImprimir />
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Kpi label="Total Pagos" valor={`${r.totalPagos}`} />
        <Kpi label="Monto Total" valor={UYU(r.montoTotal)} tono="#157A50" />
        <Kpi label="Créditos Únicos" valor={`${r.creditosUnicos}`} />
      </div>

      {/* Rendimiento mensual (gráfica + calificación del mes en curso) */}
      {serieMes.length > 1 && (
        <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-extrabold text-tinta">Rendimiento mensual</span>
              <span className="text-[11px] font-medium text-tenue">
                Recaudo por mes · la barra azul oscura es el mes en curso (parcial)
              </span>
            </div>
            {mesActual && (
              <span
                className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                style={{ background: `${calif.color}18`, color: calif.color }}
                title="Calificación del mes en curso vs el promedio de los meses previos"
              >
                {calif.label}
                {vsProm != null && ` · ${vsProm >= 0 ? "+" : ""}${vsProm}% vs promedio`}
              </span>
            )}
          </div>
          <Columnas datos={colsMes} color="#1FA971" colorHoy="#13308C" />
        </section>
      )}

      {/* Filtros (GET, sin JS) */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-[16px] border border-borde bg-tarjeta p-3.5 print:hidden">
        <Campo label="Desde">
          <input type="date" name="desde" defaultValue={desde} className={INPUT} />
        </Campo>
        <Campo label="Hasta">
          <input type="date" name="hasta" defaultValue={hasta} className={INPUT} />
        </Campo>
        <Campo label="Vendedor">
          <select name="vendedor" defaultValue={vendedorId ?? ""} className={INPUT}>
            <option value="">Todos</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Cliente / documento">
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Buscar…" className={INPUT} />
        </Campo>
        <button
          type="submit"
          className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white"
        >
          Aplicar
        </button>
      </form>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
              <th className="px-3 py-2.5 text-left">Ref Crédito</th>
              <th className="px-3 py-2.5 text-left">Vendedor</th>
              <th className="px-3 py-2.5 text-left">Cliente</th>
              <th className="px-3 py-2.5 text-right">Total Crédito</th>
              <th className="px-3 py-2.5 text-left">Fecha Pago</th>
              <th className="px-3 py-2.5 text-right">Recaudo</th>
              <th className="px-3 py-2.5 text-right">Saldo Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {r.filas.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[13px] font-medium text-gris">
                  Sin pagos en el período.
                </td>
              </tr>
            ) : (
              r.filas.map((f) => (
                <tr key={f.pagoId} className="border-b border-[#F4F6FB]">
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-gris">
                    {f.refCredito ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-cuerpo">{f.cobradorNombre ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-tinta">{f.clienteNombre}</span>
                      <span className="text-[11px] text-tenue">{f.clienteDocumento ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gris">
                    {UYU(f.totalCredito)}
                  </td>
                  <td className="px-3 py-2.5 text-cuerpo">{fechaHora(f.fechaIso)}</td>
                  <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-[#157A50]">
                    {UYU(f.monto)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-tinta">
                    {f.saldoPendiente == null ? "—" : UYU(f.saldoPendiente)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        El saldo pendiente se calcula con el cartón (misma verdad que la ficha del cliente).
        Un crédito histórico/finalizado aparece con "—".
      </p>
    </div>
  );
}

const INPUT =
  "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] outline-none focus:border-azul";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-gris">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[16px] font-extrabold tabular-nums sm:text-[20px]" style={{ color: tono ?? "var(--color-tinta)" }}>
        {valor}
      </span>
    </div>
  );
}

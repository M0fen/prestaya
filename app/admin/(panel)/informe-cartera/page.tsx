// Informe "Pago Total de Ventas a Hoy (Interés Variado)" — réplica de la captura
// 9 de Disapp. TODO derivado del cartón (sin columnas de dinero nuevas).
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getInformeCartera } from "@/lib/data/informeCartera";
import { getVendedores } from "@/lib/data/usuarios";
import { BotonImprimir } from "@/components/admin/BotonImprimir";
import { UYU, meses } from "@/lib/format";

export const dynamic = "force-dynamic";

// La tabla renderiza como máximo estas filas (ordenadas por deuda desc). Los
// TOTALES de las 4 tarjetas se calculan sobre TODA la cartera; para el detalle
// completo está el CSV. Renderizar los ~2.700 activos costaba segundos.
const LIMITE_TABLA = 300;

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}

export default async function InformeCarteraPage({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string; q?: string }>;
}) {
  const sp = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();

  const vendedorId = sp.vendedor || null;
  const q = (sp.q ?? "").trim() || null;

  const [r, vendedores] = await Promise.all([
    getInformeCartera(db, { vendedorId, q }),
    getVendedores(db),
  ]);
  const filasVisibles = r.filas.slice(0, LIMITE_TABLA);
  const hayMas = r.filas.length - filasVisibles.length;

  const qs = new URLSearchParams();
  if (vendedorId) qs.set("vendedor", vendedorId);
  if (q) qs.set("q", q);
  const csvHref = `/api/reportes/informe-cartera${qs.toString() ? `?${qs}` : ""}`;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Informe de cartera</h1>
          <span className="text-[13px] font-medium text-gris">
            Pago total de ventas a hoy (interés variado). Todo derivado del cartón.
          </span>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DCE3F4] bg-white px-4 py-2 text-[13px] font-bold text-[#2453DC] hover:bg-[#F7F9FD]"
          >
            ⬇️ Exportar CSV
          </a>
          <BotonImprimir />
        </div>
      </div>

      {/* 4 tarjetas de portada */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Total Venta" valor={UYU(r.totalVenta)} />
        <Kpi label="Utilidad (interés proyectado)" valor={UYU(r.utilidadProyectada)} tono="#7A4DD6" />
        <Kpi label="Total Recaudado" valor={UYU(r.totalRecaudado)} tono="#157A50" />
        <Kpi label="Deuda Total a Hoy" valor={UYU(r.deudaTotalAHoy)} tono="#13308C" />
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Vendedor</span>
          <select name="vendedor" defaultValue={vendedorId ?? ""} className={INPUT}>
            <option value="">Todos</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Cliente / Ref</span>
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Buscar…" className={INPUT} />
        </label>
        <button type="submit" className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white">
          Aplicar
        </button>
      </form>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-[16px] border border-[#E6EAF4] bg-white">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#EEF1F8] text-[10.5px] font-bold tracking-wide text-gris uppercase">
              <th className="px-2.5 py-2.5 text-left">Ref</th>
              <th className="px-2.5 py-2.5 text-left">Modalidad</th>
              <th className="px-2.5 py-2.5 text-left">Vendedor</th>
              <th className="px-2.5 py-2.5 text-left">Cliente</th>
              <th className="px-2.5 py-2.5 text-right">Venta</th>
              <th className="px-2.5 py-2.5 text-right">Interés %</th>
              <th className="px-2.5 py-2.5 text-right">Total</th>
              <th className="px-2.5 py-2.5 text-right">Saldo Pte</th>
              <th className="px-2.5 py-2.5 text-right">Abonos</th>
              <th className="px-2.5 py-2.5 text-left">Inicio</th>
              <th className="px-2.5 py-2.5 text-center">Cuotas</th>
              <th className="px-2.5 py-2.5 text-right">Deuda a Hoy</th>
            </tr>
          </thead>
          <tbody>
            {filasVisibles.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-[13px] font-medium text-gris">
                  Sin créditos activos para el filtro.
                </td>
              </tr>
            ) : (
              filasVisibles.map((f) => (
                <tr key={f.id} className="border-b border-[#F4F6FB]">
                  <td className="px-2.5 py-2 font-mono text-[10.5px] text-[#8A93AD]">{f.refCredito ?? "—"}</td>
                  <td className="px-2.5 py-2 capitalize text-[#3A445F]">{f.modalidad}</td>
                  <td className="px-2.5 py-2 text-[#3A445F]">{f.vendedor ?? "—"}</td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-tinta">{f.cliente}</span>
                      <span className="text-[10.5px] text-[#8A93AD]">{f.documento ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-[#3A445F]">{UYU(f.venta)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-[#6B7494]">{f.interesPct.toFixed(1)}%</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-[#3A445F]">{UYU(f.total)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-semibold text-tinta">{UYU(f.saldoPte)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-[#157A50]">{UYU(f.abonos)}</td>
                  <td className="px-2.5 py-2 text-[10.5px] text-[#8A93AD]">{fechaCorta(f.fechaInicio)}</td>
                  <td className="px-2.5 py-2 text-center tabular-nums text-[#6B7494]">{f.cuotas}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-extrabold text-[#13308C]">{UYU(f.deudaAHoy)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hayMas > 0 && (
        <p className="text-[11.5px] font-semibold text-[#6B7494]">
          Mostrando las {LIMITE_TABLA} de {r.filas.length} ventas con mayor deuda a hoy. Las 4
          tarjetas suman TODA la cartera; para el detalle completo, exportá el CSV.
        </p>
      )}

      <p className="text-[11px] leading-[1.6] font-medium text-[#AEB6CC]">
        El <b>$88,8M</b> de "Ventas Crédito" de Disapp es un bruto irreproducible desde el export.
        Presta Ya reporta el <b>capital en calle real</b> = <b>{UYU(r.deudaTotalAHoy)}</b> (Deuda Total a Hoy),
        que coincide con el dashboard. La "Utilidad" es el interés PROYECTADO (Σ total − venta) si todo se
        cobrara completo; el interés efectivamente devengado por días es un cálculo aparte (pendiente de
        conectar al módulo de mora si se necesita).
      </p>
    </div>
  );
}

const INPUT =
  "rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[13.5px] outline-none focus:border-azul";

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: tono ?? "#1A2247" }}>
        {valor}
      </span>
    </div>
  );
}

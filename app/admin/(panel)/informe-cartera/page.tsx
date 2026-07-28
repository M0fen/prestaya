// Informe "Pago Total de Ventas a Hoy (Interés Variado)" — réplica de la captura
// 9 de Disapp. TODO derivado del cartón (sin columnas de dinero nuevas).
import { requireAdmin } from "@/lib/auth";
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

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—"; // fecha ausente → guion, no "Invalid Date"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha inválida → guion
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}

export default async function InformeCarteraPage({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string; q?: string }>;
}) {
  const sp = await searchParams;
  // Solo el dueño: expone utilidad/interés/ganancia total (dato privado del admin).
  await requireAdmin();
  const db = await createSupabaseServer();

  const vendedorId = sp.vendedor || null;
  const q = (sp.q ?? "").trim() || null;

  const [r, vendedores] = await Promise.all([
    getInformeCartera(db, { vendedorId, q }),
    getVendedores(db),
  ]);
  const filasVisibles = r.filas.slice(0, LIMITE_TABLA);
  const hayMas = r.filas.length - filasVisibles.length;
  // Utilidad = interés proyectado (Con Intereses − Ventas); margen sobre el capital.
  const margen = r.totalVenta > 0 ? Math.round((r.utilidadProyectada / r.totalVenta) * 1000) / 10 : 0;

  const qs = new URLSearchParams();
  if (vendedorId) qs.set("vendedor", vendedorId);
  if (q) qs.set("q", q);
  const csvHref = `/api/reportes/informe-cartera${qs.toString() ? `?${qs}` : ""}`;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Ventas Crédito</h1>
          <span className="text-[13px] font-medium text-gris">
            Gestioná y visualizá los créditos otorgados a clientes. Todo derivado del cartón real.
          </span>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-azul-claro hover:bg-suave"
          >
            ⬇️ Exportar CSV
          </a>
          <BotonImprimir />
        </div>
      </div>

      {/* Contador de créditos (como Disapp). */}
      <span className="w-fit rounded-[12px] bg-azul-suave px-3.5 py-2 text-[13px] font-bold text-azul">
        📄 Cantidad de créditos activos: {r.filas.length.toLocaleString("es-UY")}
      </span>

      {/* KPIs (Ventas Crédito de Disapp) + Utilidad/margen (dato del dueño). */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Ventas Crédito" valor={UYU(r.totalVenta)} sub="capital colocado" />
        <Kpi label="Con Intereses" valor={UYU(r.totalConIntereses)} tono="var(--color-verde-osc)" sub="total a cobrar" />
        <Kpi label="Utilidad proyectada" valor={UYU(r.utilidadProyectada)} tono="var(--color-verde-osc)" sub={`margen ${margen}%`} />
        <Kpi label="Recaudo" valor={UYU(r.totalRecaudado)} tono="var(--color-azul)" sub="abonado a hoy" />
        <Kpi label="Cartera Pendiente" valor={UYU(r.deudaTotalAHoy)} tono="var(--color-ambar-osc)" sub="saldo por cobrar" />
        <Kpi
          label="% Recaudo"
          valor={`${r.totalConIntereses > 0 ? Math.round((r.totalRecaudado / r.totalConIntereses) * 1000) / 10 : 0}%`}
          tono="var(--color-rojo-osc)"
          sub="recaudo / total"
        />
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
      <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-linea text-[10.5px] font-bold tracking-wide text-gris uppercase">
              <th className="hidden px-2.5 py-2.5 text-left md:table-cell">Ref</th>
              <th className="hidden px-2.5 py-2.5 text-left md:table-cell">Modalidad</th>
              <th className="hidden px-2.5 py-2.5 text-left md:table-cell">Vendedor</th>
              <th className="sticky left-0 z-[1] bg-tarjeta px-2.5 py-2.5 text-left">Cliente</th>
              <th className="px-2.5 py-2.5 text-right">Venta</th>
              <th className="hidden px-2.5 py-2.5 text-right md:table-cell">Interés %</th>
              <th className="hidden px-2.5 py-2.5 text-right md:table-cell">Total</th>
              <th className="px-2.5 py-2.5 text-right">Saldo</th>
              <th className="px-2.5 py-2.5 text-right">Abonos</th>
              <th className="hidden px-2.5 py-2.5 text-left md:table-cell">Inicio</th>
              <th className="hidden px-2.5 py-2.5 text-center md:table-cell">Cuotas</th>
              <th className="px-2.5 py-2.5 text-center">Estado</th>
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
                <tr key={f.id} className="border-b border-linea">
                  <td className="hidden px-2.5 py-2 font-mono text-[10.5px] text-tenue md:table-cell">{f.refCredito ?? "—"}</td>
                  <td className="hidden px-2.5 py-2 capitalize text-cuerpo md:table-cell">{f.modalidad}</td>
                  <td className="hidden px-2.5 py-2 text-cuerpo md:table-cell">{f.vendedor ?? "—"}</td>
                  <td className="sticky left-0 z-[1] bg-tarjeta px-2.5 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-tinta">{f.cliente}</span>
                      <span className="text-[10.5px] text-tenue">{f.documento ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-cuerpo">{UYU(f.venta)}</td>
                  <td className="hidden px-2.5 py-2 text-right tabular-nums text-gris md:table-cell">{Number.isFinite(f.interesPct) ? f.interesPct.toFixed(1) : "0"}%</td>
                  <td className="hidden px-2.5 py-2 text-right tabular-nums text-cuerpo md:table-cell">{UYU(f.total)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-extrabold text-azul">{UYU(f.saldoPte)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-verde-osc">{UYU(f.abonos)}</td>
                  <td className="hidden px-2.5 py-2 text-[10.5px] text-tenue md:table-cell">{fechaCorta(f.fechaInicio)}</td>
                  <td className="hidden px-2.5 py-2 text-center tabular-nums text-gris md:table-cell">{f.cuotas}</td>
                  <td className="px-2.5 py-2 text-center">
                    <span className="rounded-full bg-suave px-2.5 py-1 text-[10.5px] font-bold text-verde-osc">
                      Activo
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hayMas > 0 && (
        <p className="text-[11.5px] font-semibold text-gris">
          Mostrando las {LIMITE_TABLA} de {r.filas.length.toLocaleString("es-UY")} ventas con mayor deuda a
          hoy. Los KPIs de arriba suman TODA la cartera; para el detalle completo, exportá el CSV.
        </p>
      )}

      <p className="text-[11px] leading-[1.6] font-medium text-tenue-2">
        Todo derivado del cartón real: <b>Ventas Crédito</b> = capital colocado; <b>Con Intereses</b> = total
        a cobrar (interés incluido en la cuota); <b>Utilidad proyectada</b> = Σ del interés por crédito (interés a
        ganar si todos pagan) — es PROYECTADA, no ganancia neta; <b>Recaudo</b> =
        abonado a hoy; <b>Cartera Pendiente</b> = saldo por cobrar. <b>Saldo Pendiente (a hoy)</b> por fila es esa
        misma deuda a la fecha. <b>Sin filtros</b>, la Cartera Pendiente coincide con el “Capital en calle” del
        dashboard; al filtrar por vendedor o búsqueda, los KPIs son de lo filtrado. El <b>% Recaudo</b> = Recaudo /
        Con Intereses.
      </p>
    </div>
  );
}

const INPUT =
  "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] outline-none focus:border-azul";

function Kpi({ label, valor, tono, sub }: { label: string; valor: string; tono?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {valor}
      </span>
      {sub && <span className="text-[10.5px] font-medium text-tenue-2">{sub}</span>}
    </div>
  );
}

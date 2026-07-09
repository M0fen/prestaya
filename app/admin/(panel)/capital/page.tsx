// Inversión de capital (solo ADMIN). Libro aparte sobre movimientos_caja con
// cuenta='capital': aportes, retiros del dueño, transferencias y descuadres.
// NO incluye cobros (eso es la caja operativa).
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getMovimientosCapital } from "@/lib/data/capital";
import { getVendedores } from "@/lib/data/usuarios";
import { FormMovimientoCaja } from "@/components/admin/FormMovimientoCaja";
import { UYU, horaDe, meses } from "@/lib/format";
import { diaUYInicioIso, diaUYFinIso, fechaISOUY } from "@/lib/fecha";

export const dynamic = "force-dynamic";

const esYmd = (v: string | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—"; // fecha ausente → guion, no "Invalid Date"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha inválida → guion
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${horaDe(iso)}`;
}

export default async function CapitalPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; vendedor?: string }>;
}) {
  const sp = await searchParams;
  await requireAdmin();
  const db = await createSupabaseServer();

  const hoyYmd = fechaISOUY();
  const desde = esYmd(sp.desde) ?? hoyYmd;
  const hasta = esYmd(sp.hasta) ?? hoyYmd;
  const vendedorId = sp.vendedor || null;

  const [r, vendedores] = await Promise.all([
    getMovimientosCapital(db, {
      desde: diaUYInicioIso(desde),
      hasta: diaUYFinIso(hasta),
      vendedorId,
    }),
    getVendedores(db),
  ]);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Inversión de capital</h1>
        <span className="text-[13px] font-medium text-gris">
          Aportes, retiros del dueño, transferencias y descuadres. Aparte de la caja operativa.
        </span>
      </div>

      {/* 3 tarjetas */}
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi label="Total Ingresos" valor={UYU(r.totalIngresos)} tono="#157A50" />
        <Kpi label="Total Retiros" valor={UYU(r.totalRetiros)} tono="#C0392B" />
        <Kpi label="Capital Total" valor={UYU(r.capitalTotal)} tono={r.capitalTotal >= 0 ? "#13308C" : "#C0392B"} />
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Desde</span>
          <input type="date" name="desde" defaultValue={desde} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Hasta</span>
          <input type="date" name="hasta" defaultValue={hasta} className={INPUT} />
        </label>
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
        <button type="submit" className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white">
          Aplicar
        </button>
      </form>

      <FormMovimientoCaja cuenta="capital" />

      {/* Tabla */}
      <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
              <th className="px-3 py-2.5 text-left">Operación</th>
              <th className="px-3 py-2.5 text-left">Concepto</th>
              <th className="px-3 py-2.5 text-left">Vendedor</th>
              <th className="px-3 py-2.5 text-left">Fecha y hora</th>
              <th className="px-3 py-2.5 text-right">(+) Ingreso</th>
              <th className="px-3 py-2.5 text-right">(−) Retiro</th>
            </tr>
          </thead>
          <tbody>
            {r.libro.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[13px] font-medium text-gris">
                  Sin movimientos de capital en el período.
                </td>
              </tr>
            ) : (
              r.libro.map((l, i) => (
                <tr key={i} className="border-b border-[#F4F6FB]">
                  <td className="px-3 py-2.5">
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={
                        l.operacion === "ingreso"
                          ? { background: "#E4F5EC", color: "#157A50" }
                          : { background: "#FBE4E2", color: "#C0392B" }
                      }
                    >
                      {l.operacion === "ingreso" ? "Ingreso" : "Retiro"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-tinta">{l.concepto}</td>
                  <td className="px-3 py-2.5 text-cuerpo">{l.vendedor ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[11.5px] text-tenue">{fechaHora(l.fechaIso)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-[#157A50]">
                    {l.operacion === "ingreso" ? UYU(l.monto) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-[#C0392B]">
                    {l.operacion === "retiro" ? UYU(l.monto) : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const INPUT =
  "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] outline-none focus:border-azul";

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: tono ?? "#1A2247" }}>
        {valor}
      </span>
    </div>
  );
}

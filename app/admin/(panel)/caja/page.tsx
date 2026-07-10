// Caja diaria (admin/supervisor): ingresos vs egresos OPERATIVOS de un rango
// (Desde/Hasta, hoy por defecto), efectivo a rendir por cobrador, libro de
// movimientos con columna Visible, y alta de gastos/desembolsos/aportes/retiros.
// Los cobros vienen de `pagos`. El capital vive en /admin/capital.
import Link from "next/link";
import { requireGestor, getActorActual } from "@/lib/auth";
import { puedeVerZona } from "@/lib/permisos";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenCajaRango, type LineaLibro } from "@/lib/data/caja";
import { getCierrePorZona } from "@/lib/data/cierreZona";
import { FormMovimientoCaja } from "@/components/admin/FormMovimientoCaja";
import { CierrePorZona } from "@/components/admin/CierrePorZona";
import { BotonImprimir } from "@/components/admin/BotonImprimir";
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

const COLOR_LINEA: Record<LineaLibro["tipo"], string> = {
  cobro: "#1FA971",
  ingreso: "#1FA971",
  egreso: "#C0392B",
  desembolso: "#C0562B",
  retiro: "#B9770E",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();

  const hoyYmd = fechaISOUY();
  const desde = esYmd(sp.desde) ?? hoyYmd;
  const hasta = esYmd(sp.hasta) ?? hoyYmd;
  const esHoy = desde === hoyYmd && hasta === hoyYmd;

  const r = await getResumenCajaRango(db, {
    desde: diaUYInicioIso(desde),
    hasta: diaUYFinIso(hasta),
  });
  // Cierre por zona (rendiciones agrupadas): solo tiene sentido cuando es "hoy".
  const actor = await getActorActual();
  const cierre = esHoy ? await getCierrePorZona(db) : null;
  // Zonas que el usuario actual puede cerrar (supervisor de la zona; admin todas).
  const cerrables =
    actor && cierre
      ? cierre.consolidado.zonas
          .filter((z) => z.zonaId && puedeVerZona(actor, z.zonaId))
          .map((z) => z.zonaId as string)
      : [];

  const qs = new URLSearchParams({ desde, hasta, periodo: esHoy ? "hoy" : "mes" });
  const csvHref = `/api/reportes/caja?${qs.toString()}`;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Caja diaria</h1>
          <span className="text-[13px] font-medium text-gris">
            Ingresos, egresos y efectivo operativo. El capital va en su propia pantalla.
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

      {/* Cómo funciona la caja diaria — el flujo completo, para que no falte contexto. */}
      <details className="rounded-[14px] border border-borde bg-[#F7F9FE] px-4 py-3 print:hidden">
        <summary className="cursor-pointer text-[12.5px] font-extrabold text-tinta">
          ¿Cómo funciona la caja diaria? (el flujo completo)
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 text-[12px] leading-[1.6] font-medium text-gris">
          <p>
            <b className="text-tinta">1. Cobros.</b> Entran solos desde la calle (tabla de pagos, inmutable). No se
            cargan a mano acá.
          </p>
          <p>
            <b className="text-tinta">2. Rendición del cobrador.</b> Al cerrar su jornada declara gastos y efectivo
            entregado. El sistema calcula <b>esperado = recaudado − gastos</b> y la <b>diferencia</b>:{" "}
            <b className="text-[#157A50]">cuadra</b>, <b className="text-[#C0392B]">faltante</b> o{" "}
            <b className="text-azul">sobrante</b> (ver "Cierre por zona" abajo).
          </p>
          <p>
            <b className="text-tinta">3. Qué pasa con un faltante / float sin rendir.</b> No queda solo anotado: baja
            el <b>score de confianza</b> del cobrador y suma a su <b>cuenta corriente</b> (recaudado vs rendido). Ahí
            actuás: mirá el historial en el{" "}
            <Link href="/admin/alertas" className="font-bold text-azul">Centro de alertas</Link>.
          </p>
          <p>
            <b className="text-tinta">4. Cerrar la zona (supervisor).</b> Recibe el efectivo de sus cobradores y
            confirma la entrega a la caja central. Queda con sello y en auditoría.
          </p>
          <p>
            <b className="text-tinta">5. Movimientos.</b> Gastos, desembolsos, aportes y retiros OPERATIVOS se cargan
            abajo. El <b>capital</b> (aportes/retiros del dueño) va en su propia pantalla. Comisiones se liquidan en{" "}
            <Link href="/admin/comisiones" className="font-bold text-azul">Comisiones</Link> (registran un egreso acá).
          </p>
        </div>
      </details>

      {/* Rango de fechas (GET, sin JS) */}
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Desde</span>
          <input type="date" name="desde" defaultValue={desde} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Hasta</span>
          <input type="date" name="hasta" defaultValue={hasta} className={INPUT} />
        </label>
        <button type="submit" className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white">
          Aplicar
        </button>
      </form>

      {/* 3 tarjetas (como Disapp) */}
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi label="Balance operativo" valor={UYU(r.neto)} tono={r.neto >= 0 ? "#157A50" : "#C0392B"} />
        <Kpi label="Total Entradas" valor={UYU(r.ingresosTotal)} tono="#157A50" />
        <Kpi label="Total Egresos" valor={UYU(r.egresosTotal)} tono="#C0392B" />
      </div>
      <p className="-mt-2 text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        <b>Balance = Entradas − Egresos</b> (contable/devengado). Entradas incluye los cobros del día aunque parte
        siga <b>por rendir</b> (en la calle). <b>Egresos</b> = gastos + desembolsos + retiros operativos (no solo
        retiros del dueño). El efectivo físico ya entregado se ve en "Cierre por zona".
      </p>

      <FormMovimientoCaja />

      {/* Desglose de egresos */}
      {r.egresosPorCategoria.length > 0 && (
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
          <span className="text-[13px] font-bold text-tinta">Egresos por categoría</span>
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {r.egresosPorCategoria.map((e) => (
              <li key={e.categoria} className="flex items-center justify-between py-2">
                <span className="text-[13px] font-medium text-cuerpo">{e.categoria}</span>
                <span className="text-[13.5px] font-extrabold text-tinta tabular-nums">{UYU(e.monto)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Efectivo a rendir por cobrador */}
      {r.porCobrador.length > 0 && (
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
          <span className="text-[13px] font-bold text-tinta">
            {esHoy ? "Efectivo a rendir hoy" : "Recaudado por cobrador"}
          </span>
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {r.porCobrador.map((c) => (
              <li key={c.nombre} className="flex items-center justify-between py-2">
                <span className="text-[13px] font-semibold text-tinta">{c.nombre}</span>
                <span className="text-[12px] font-medium text-gris">
                  {c.cobros} cobro{c.cobros === 1 ? "" : "s"}
                </span>
                <span className="text-[13.5px] font-extrabold text-tinta tabular-nums">{UYU(c.recaudado)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cierre por zona: rendiciones agrupadas + confirmación del supervisor (solo hoy) */}
      {cierre && <CierrePorZona resumen={cierre} cerrables={cerrables} />}

      {/* Libro de movimientos con columna Visible */}
      <section className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        <div className="px-4 pt-4">
          <span className="text-[13px] font-bold text-tinta">Libro de caja</span>
        </div>
        {r.libro.length === 0 ? (
          <p className="px-4 py-6 text-[13px] font-medium text-gris">Sin movimientos en el período.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-4 py-2.5 text-left">Concepto</th>
                <th className="px-3 py-2.5 text-left">Fecha</th>
                <th className="px-3 py-2.5 text-center">Visible</th>
                <th className="px-4 py-2.5 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {r.libro.map((l, i) => (
                <tr key={i} className="border-b border-[#F4F6FB]">
                  <td className="px-4 py-2.5 font-semibold text-tinta">{l.concepto}</td>
                  <td className="px-3 py-2.5 text-[11.5px] text-tenue">{fechaHora(l.fechaIso)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {l.visible ? (
                      <span className="text-[11px] font-bold text-[#157A50]">Sí</span>
                    ) : (
                      <span className="text-[11px] font-bold text-tenue">No</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right text-[13.5px] font-extrabold tabular-nums"
                    style={{ color: COLOR_LINEA[l.tipo] }}
                  >
                    {l.signo > 0 ? "+" : "−"}
                    {UYU(l.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Los cobros entran automáticamente desde la calle (tabla de pagos, inmutable). Acá se cargan
        gastos, desembolsos, aportes y retiros OPERATIVOS. El balance = entradas − retiros.
      </p>
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

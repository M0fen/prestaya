// ─────────────────────────────────────────────────────────────────────────
//  MOVIMIENTOS DEL DÍA (y de días anteriores) — el "informe del día" del PANEL.
//
//  Quejas del admin (16-08): "poder ver los pagos de días anteriores" y "poder
//  ver las ventas del día y también de días anteriores". Los pagos por rango
//  YA existían en /admin/recaudos, pero arrancaban en HOY sin decirlo y el
//  filtro estaba debajo del gráfico; las VENTAS uno por uno no existían en el
//  panel (solo agregados anclados a hoy) — la lista vivía en la app del
//  cobrador y solo para su día. Esta pantalla es LA lectura completa: un día
//  (o un rango) elegido ARRIBA, siempre rotulado, con los pagos Y las ventas
//  uno por uno, de todos los cobradores del alcance o de uno solo.
//
//  SOLO LECTURA. Alcance por zona (supervisor ve su zona; admin, todo).
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getInformeRango } from "@/lib/data/informeDia";
import { getVendedores } from "@/lib/data/usuarios";
import { alcanceDelActor } from "@/lib/data/alcance";
import { fechaISOUY } from "@/lib/fecha";
import { conTimeout } from "@/lib/timeout";
import { BotonImprimir } from "@/components/admin/BotonImprimir";
import { UYU, horaDe, meses } from "@/lib/format";
import { esUuid } from "@/lib/idempotencia";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;
/** Cap defensivo del rango: dos meses. Más que eso es un export, no una pantalla. */
const MAX_DIAS = 62;

const esYmd = (v: string | undefined): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const sumarDias = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * 86_400_000).toISOString().slice(0, 10);

function rotuloDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${dias[dt.getUTCDay()]} ${d} de ${meses[m - 1]}`;
}
function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} · ${horaDe(iso)}`;
}

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; vendedor?: string }>;
}) {
  const sp = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();

  const hoyYmd = fechaISOUY();
  let desde = esYmd(sp.desde) ?? hoyYmd;
  let hasta = esYmd(sp.hasta) ?? desde;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diasEntre(desde, hasta) > MAX_DIAS) desde = sumarDias(hasta, -MAX_DIAS);
  const vendedorId = esUuid(sp.vendedor) ? sp.vendedor : null;
  const unDia = desde === hasta;

  const alcance = await alcanceDelActor();
  const cobradorIds = alcance.global ? null : alcance.cobradorIds;
  // Un vendedor pedido fuera del alcance → nada (no filtrar por él sería fuga).
  const vendedorValido = vendedorId && (alcance.global || alcance.cobradorIds.includes(vendedorId)) ? vendedorId : null;

  const [inf, vendedores] = await conTimeout(
    Promise.all([
      getInformeRango({
        desdeYmd: desde,
        hastaYmd: hasta,
        cobradorIds: vendedorId && !vendedorValido ? [] : cobradorIds,
        cobradorId: vendedorValido,
      }),
      getVendedores(db, cobradorIds),
    ]),
    TOPE_MS,
    "admin.movimientos",
  );

  const rotulo = unDia ? rotuloDia(desde) : `${rotuloDia(desde)} → ${rotuloDia(hasta)}`;
  const esHoy = unDia && desde === hoyYmd;
  const qVend = vendedorValido ? `&vendedor=${vendedorValido}` : "";
  const linkDia = (ymd: string) => `/admin/movimientos?desde=${ymd}&hasta=${ymd}${qVend}`;
  const nombreVendedor = vendedorValido ? vendedores.find((v) => v.id === vendedorValido)?.nombre ?? "vendedor" : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[20px] font-extrabold text-tinta">Movimientos del día</h1>
          {/* El DÍA que se está mirando, SIEMPRE dicho — la mitad de la queja era
              que la pantalla mostraba hoy sin rotularlo. */}
          <p className="text-[13px] font-semibold text-azul">
            {esHoy ? "Hoy · " : ""}{rotulo}{nombreVendedor ? ` · ${nombreVendedor}` : ""}
          </p>
        </div>
        <BotonImprimir />
      </div>

      {/* Navegación por DÍA arriba de todo: anterior / hoy / siguiente de un toque. */}
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <Link href={linkDia(sumarDias(desde, -1))} className="rounded-full border border-borde bg-tarjeta px-3.5 py-2 text-[13px] font-bold text-tinta hover:bg-suave">
          ← Día anterior
        </Link>
        {!esHoy && (
          <Link href={linkDia(hoyYmd)} className="rounded-full bg-[#EEF3FF] px-3.5 py-2 text-[13px] font-bold text-azul hover:bg-[#E3EBFF]">
            Hoy
          </Link>
        )}
        {(unDia ? desde : hasta) < hoyYmd && (
          <Link href={linkDia(sumarDias(unDia ? desde : hasta, 1))} className="rounded-full border border-borde bg-tarjeta px-3.5 py-2 text-[13px] font-bold text-tinta hover:bg-suave">
            Día siguiente →
          </Link>
        )}
        <form method="get" className="ml-auto flex flex-wrap items-end gap-2">
          <Campo label="Desde"><input type="date" name="desde" defaultValue={desde} max={hoyYmd} className={INPUT} /></Campo>
          <Campo label="Hasta"><input type="date" name="hasta" defaultValue={hasta} max={hoyYmd} className={INPUT} /></Campo>
          <Campo label="Cobrador">
            <select name="vendedor" defaultValue={vendedorValido ?? ""} className={INPUT}>
              <option value="">Todos</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}</option>
              ))}
            </select>
          </Campo>
          <button type="submit" className="btn-primario px-4 py-2.5 text-[13px] font-bold text-white">Ver</button>
        </form>
      </div>

      {/* Totales del rango */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Pagos" valor={`${inf.totales.pagos}`} />
        <Kpi label="Recaudado" valor={UYU(inf.totales.recaudado)} tono="var(--color-verde-osc)" />
        <Kpi label="Ventas" valor={`${inf.totales.ventas}`} />
        <Kpi label="Colocado" valor={UYU(inf.totales.colocado)} tono="var(--color-azul)" />
      </div>

      {/* VENTAS del rango */}
      <section className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-extrabold text-tinta">Ventas y renovaciones ({inf.totales.ventas})</h2>
          <span className="text-[11px] font-medium text-tenue">créditos creados desde la app · las deshechas van tachadas</span>
        </div>
        {inf.colocaciones.length === 0 ? (
          <p className="py-4 text-center text-[13px] font-medium text-gris">Sin ventas {unDia ? "ese día" : "en el rango"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                  <th className="px-3 py-2 text-left">Cuándo</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Cobrador</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-right">Plan</th>
                </tr>
              </thead>
              <tbody>
                {inf.colocaciones.map((c) => (
                  <tr key={c.prestamoId} className={`border-b border-linea last:border-0 ${c.cancelada ? "opacity-50 line-through" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gris">{fechaHora(c.creadoEn)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/clientes/${c.clienteId}`} className="font-bold text-azul hover:underline">{c.clienteNombre}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-black ${c.cancelada ? "bg-[#F1F4FB] text-gris" : c.esRenovacion ? "bg-[#E4F5EC] text-[#157A50]" : "bg-[#EEF3FF] text-[#1E47C8]"}`}>
                        {c.cancelada ? "DESHECHA" : c.esRenovacion ? "Renovación" : "Venta"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-cuerpo">{c.cobradorNombre}</td>
                    <td className="px-3 py-2 text-right font-extrabold tabular-nums text-tinta">{UYU(c.monto)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gris">{c.totalDias}× {UYU(c.cuota)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* PAGOS del rango */}
      <section className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-extrabold text-tinta">Pagos ({inf.totales.pagos})</h2>
          <Link href={`/admin/recaudos?desde=${desde}&hasta=${hasta}${qVend}`} className="text-[12px] font-bold text-azul hover:underline">
            Ver en Recaudos (buscar, CSV) →
          </Link>
        </div>
        {inf.pagos.length === 0 ? (
          <p className="py-4 text-center text-[13px] font-medium text-gris">Sin pagos registrados {unDia ? "ese día" : "en el rango"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                  <th className="px-3 py-2 text-left">Cuándo</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Cobrador</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {inf.pagos.map((p) => (
                  <tr key={p.id} className="border-b border-linea last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gris">{fechaHora(p.registradoEn)}</td>
                    <td className="px-3 py-2">
                      {p.clienteId ? (
                        <Link href={`/admin/clientes/${p.clienteId}`} className="font-bold text-azul hover:underline">{p.clienteNombre}</Link>
                      ) : (
                        <span className="font-bold text-tinta">{p.clienteNombre}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-cuerpo">{p.cobradorNombre}</td>
                    <td className="px-3 py-2 text-right font-extrabold tabular-nums text-[#157A50]">{UYU(p.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const INPUT = "rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul";
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
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-sm">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[16px] font-extrabold tabular-nums sm:text-[20px]" style={{ color: tono ?? "var(--color-tinta)" }}>{valor}</span>
    </div>
  );
}

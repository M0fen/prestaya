// TRAZABILIDAD DEL EMPALME — para admin (Mauro/Carolina) y dev (Carlos): revisar
// con detalle cada DIFERENCIA de dinero entre la app y el libro de pagos, la salud
// del empalme, el historial de reconciliaciones, y el kill switch de emergencia.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getInfoEmpalme,
  getSaludEmpalme,
  getHistorialReconciliacion,
  hallazgosExtraDelDia,
} from "@/lib/data/reconciliacion";
import { KillSwitch } from "@/components/admin/KillSwitch";
import { ResolverDiscrepancia } from "@/components/admin/ResolverDiscrepancia";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
function soloFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo", weekday: "short", day: "2-digit", month: "2-digit",
  }).format(new Date(iso));
}

export default async function EmpalmePage() {
  await requireAdmin();
  const db = createSupabaseAdmin();
  const [info, salud, historial, operativos] = await Promise.all([
    getInfoEmpalme(db),
    getSaludEmpalme(db),
    getHistorialReconciliacion(db, 14),
    // Invariantes OPERATIVAS (rendición vs libro, base de caja, gastos sin respaldo,
    // lead de tienda, crédito sin ruta). El cron ya las evaluaba y avisaba por push,
    // pero esta página —la que mira un humano— sólo mostraba diferencias de SALDO:
    // podía decir "✅ la plata cuadra" con un cobrador que no rindió o un crédito
    // fuera de toda ruta. Mostrarlas acá alinea el panel con el vigilante.
    hallazgosExtraDelDia(db, new Date()).catch(() => []),
  ]);
  const opCriticos = operativos.filter((h) => h.severidad === "critico" || h.severidad === "alto");

  // FRESCURA del vigilante: la reconciliación AUTOMÁTICA (origen 'cron') corre 1×/día.
  // Si la última pasó hace >26h (o nunca corrió), el vigilante está CAÍDO → hay que
  // gritarlo, porque "no hay señal" es el fallo más peligroso (un cron muerto se veía
  // "sano" mostrando el historial viejo). Causa típica: falta CRON_SECRET en Vercel.
  const ultimaCron = historial.find((h) => h.origen === "cron");
  const horasSinCron = ultimaCron
    ? (Date.now() - new Date(ultimaCron.corridaEn).getTime()) / 3_600_000
    : Infinity;
  const cronCaido = horasSinCron > 26;

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Empalme y reconciliación</h1>
        <span className="text-[13px] font-medium text-gris">
          Trazabilidad de las diferencias de dinero entre la app y el libro de pagos. La reconciliación
          corre cada mañana (07:00) y avisa por push si aparece algo crítico nuevo.
        </span>
      </div>

      <KillSwitch activo={info.soloLectura} />

      {/* ── VIGILANTE CAÍDO (frescura del cron) ── */}
      {cronCaido && (
        <section
          className="rounded-[16px] border px-4 py-3.5"
          style={{ borderColor: "var(--color-rojo-osc)", background: "var(--color-rojo-suave)" }}
        >
          <span className="text-[13.5px] font-extrabold" style={{ color: "var(--color-rojo-osc)" }}>
            ⚠️ La reconciliación automática NO está corriendo
          </span>
          <p className="mt-0.5 text-[12px] leading-[1.5] font-medium" style={{ color: "var(--color-rojo-osc)" }}>
            {ultimaCron
              ? `Última corrida automática: ${fechaHora(ultimaCron.corridaEn)} (hace ${Math.round(horasSinCron)} h). Debería correr cada mañana.`
              : "Nunca corrió una reconciliación automática."}{" "}
            La plata no se está verificando a diario. Revisá que <b>CRON_SECRET</b> esté seteado en Vercel (sin
            eso el cron falla cerrado). Mientras tanto, corré la reconciliación a mano (ver abajo).
          </p>
        </section>
      )}

      {/* ── SALUD DEL EMPALME ── */}
      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[15px] font-extrabold text-tinta">Salud del empalme</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Kpi label="Créditos activos" valor={salud.creditosActivos.toLocaleString("es-UY")} />
          <Kpi label="Finalizados" valor={salud.creditosFinalizados.toLocaleString("es-UY")} />
          <Kpi label="Clientes" valor={salud.clientes.toLocaleString("es-UY")} />
          <Kpi label="Pagos (libro)" valor={salud.pagos.toLocaleString("es-UY")} />
          <Kpi label="Capital en calle" valor={UYU(salud.carteraActiva)} chico />
          <Kpi label="Créditos (total)" valor={salud.creditosTotal.toLocaleString("es-UY")} chico />
          <Kpi label="Último pago" valor={fechaHora(salud.ultimoPago)} chico ancho />
        </div>
      </section>

      {/* ── ESTADO DE RECONCILIACIÓN ── */}
      {!info.disponible ? (
        <section className="rounded-[16px] panel-ambar px-4 py-6 text-center">
          <span className="text-[13px] font-bold text-ambar-osc">Reconciliación no disponible.</span>
          <p className="mt-1 text-[12px] font-medium text-ambar-osc">Falta correr la migración 0071 (RPC de reconciliación).</p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="px-0.5 text-[15px] font-extrabold text-tinta">Estado ahora</h2>
          <div
            className="flex items-center justify-between rounded-[14px] border px-4 py-3"
            style={{
              borderColor: info.criticasSinResolver === 0 ? "var(--color-verde-osc)" : "var(--color-rojo-osc)",
              background: info.criticasSinResolver === 0 ? "var(--color-verde-suave)" : "var(--color-rojo-suave)",
            }}
          >
            <div className="flex flex-col">
              <span className="text-[14px] font-extrabold" style={{ color: info.criticasSinResolver === 0 ? "var(--color-verde-osc)" : "var(--color-rojo-osc)" }}>
                {info.criticasSinResolver === 0
                  ? info.totalDiferencias === 0
                    ? "✅ La plata cuadra: cero diferencias."
                    : info.criticas === 0
                      ? "✅ Sano: sin diferencias críticas vivas."
                      : `✅ Sano: ${info.criticas} crítica(s), todas revisadas/aceptadas.`
                  : `🔴 ${info.criticasSinResolver} diferencia(s) crítica(s) sin resolver — revisar`}
              </span>
              <span className="text-[12px] font-medium text-gris">
                {info.totalDiferencias} en total · {info.criticas} materiales · {info.totalDiferencias - info.criticas} de redondeo (baseline)
              </span>
            </div>
            <span className="text-[26px] font-black tabular-nums" style={{ color: info.criticasSinResolver === 0 ? "var(--color-verde-osc)" : "var(--color-rojo-osc)" }}>
              {info.criticasSinResolver}
            </span>
          </div>
        </section>
      )}

      {/* ── HALLAZGOS OPERATIVOS (lo que NO es diferencia de saldo) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[15px] font-extrabold text-tinta">Controles del día</h2>
        {operativos.length === 0 ? (
          <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-3 text-[12.5px] font-medium text-gris">
            ✅ Sin hallazgos: las rendiciones de ayer coinciden con el libro, los gastos están
            respaldados, las bases de caja cuadran y todo crédito activo está en la ruta de alguien.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {operativos.slice(0, 40).map((h, i) => {
              const grave = h.severidad === "critico" || h.severidad === "alto";
              return (
                <div
                  key={i}
                  className="flex items-start gap-2.5 rounded-[12px] border px-3.5 py-2.5"
                  style={{
                    borderColor: grave ? "var(--color-rojo-osc)" : "var(--color-borde)",
                    background: grave ? "var(--color-rojo-suave)" : "var(--color-tarjeta)",
                  }}
                >
                  <span
                    className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      background: grave ? "var(--color-rojo-osc)" : "var(--color-ambar-suave)",
                      color: grave ? "#fff" : "var(--color-ambar-osc)",
                    }}
                  >
                    {h.severidad}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[12.5px] font-bold text-tinta">{h.invariante}</span>
                    <span className="text-[12px] leading-[1.45] font-medium break-words text-gris">{h.detalle}</span>
                  </div>
                </div>
              );
            })}
            {operativos.length > 40 && (
              <p className="px-1 text-[11.5px] font-medium text-tenue-2">
                y {operativos.length - 40} más ({opCriticos.length} graves en total).
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── HISTORIAL DE CORRIDAS ── */}
      {historial.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-0.5 text-[15px] font-extrabold text-tinta">Historial (últimas corridas)</h2>
          <div className="overflow-x-auto rounded-[14px] border border-borde bg-tarjeta">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="border-b border-linea text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                  <th className="px-3 py-2.5">Cuándo</th>
                  <th className="px-3 py-2.5">Resultado</th>
                  <th className="px-3 py-2.5 text-right">Críticas</th>
                  <th className="px-3 py-2.5 text-right">Total dif.</th>
                  <th className="px-3 py-2.5 text-right">Recaudo del día</th>
                  <th className="px-3 py-2.5">Origen</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((c, i) => (
                  <tr key={i} className="border-b border-linea last:border-0">
                    <td className="px-3 py-2.5 font-medium text-tinta capitalize">{soloFecha(c.corridaEn)}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                        style={{ background: c.criticos === 0 ? "var(--color-verde-suave)" : "var(--color-rojo-suave)", color: c.criticos === 0 ? "var(--color-verde-osc)" : "var(--color-rojo-osc)" }}
                      >
                        {c.criticos === 0 ? "Sano" : "Atención"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: c.criticos === 0 ? "var(--color-gris)" : "var(--color-rojo-osc)" }}>{c.criticos}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gris">{c.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-tinta">{UYU(c.recaudoLibro)}</td>
                    <td className="px-3 py-2.5 text-gris">{c.origen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── DETALLE DE LAS DIFERENCIAS ── */}
      {info.disponible && info.totalDiferencias > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-0.5">
            <h2 className="text-[15px] font-extrabold text-tinta">Detalle de las diferencias</h2>
            <span className="text-[11.5px] font-medium text-gris">
              {info.criticas} materiales · {info.totalDiferencias - info.criticas} de redondeo
            </span>
          </div>
          <div className="overflow-x-auto rounded-[14px] border border-borde bg-tarjeta">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="border-b border-linea text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                  <th className="px-3 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Estado</th>
                  <th className="px-3 py-2.5 text-right">Pagado (app)</th>
                  <th className="px-3 py-2.5 text-right">Libro (Σpagos)</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">Diferencia</th>
                  <th className="px-3 py-2.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {info.diferencias.map((d) => {
                  const dif = d.tipo === "drift" ? d.drift : d.exceso;
                  return (
                    <tr key={d.creditoId} className="border-b border-linea last:border-0">
                      <td className="px-3 py-2.5">
                        <a href={`/admin/clientes?credito=${d.creditoId}`} className="font-bold text-azul hover:underline">
                          {d.clienteNombre}
                        </a>
                        <span className="ml-1 text-[10.5px] text-tenue-2">#{d.creditoId.slice(0, 8)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                          style={{ background: d.material ? "var(--color-rojo-suave)" : "var(--color-suave)", color: d.material ? "var(--color-rojo-osc)" : "var(--color-gris)" }}
                        >
                          {d.tipo === "drift" ? "Saldo≠libro" : "Sobre-cobro"}{d.material ? " · material" : " · redondeo"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gris">{d.estado}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-tinta">{UYU(d.pagadoAcum)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-tinta">{UYU(d.pagosSuma)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gris">{UYU(d.totalAPagar)}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums" style={{ color: d.material ? "var(--color-rojo-osc)" : "var(--color-ambar-osc)" }}>
                        {dif > 0 ? "+" : ""}{UYU(dif)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ResolverDiscrepancia
                          creditoId={d.creditoId}
                          tipo={d.tipo}
                          montoDiferencia={dif}
                          triage={d.triage ? { estado: d.triage.estado, nota: d.triage.nota } : null}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── LEYENDA / CÓMO LEER ESTO ── */}
      <section className="rounded-[14px] border border-borde bg-suave p-4">
        <h3 className="mb-1.5 text-[13px] font-extrabold text-tinta">Cómo leer esto</h3>
        <ul className="flex flex-col gap-1.5 text-[12px] leading-[1.5] font-medium text-gris">
          <li><b className="text-tinta">Saldo≠libro</b>: el saldo denormalizado de la app no coincide con la suma real de pagos. Siempre a revisar (los saldos/cartera dependen de que sea exacto).</li>
          <li><b className="text-tinta">Sobre-cobro</b>: el crédito registra más pagos que su total. <b>Material</b> (≥1 cuota o ≥5% del total) merece mirada; <b>redondeo</b> es ruido pre-existente del empalme original — casi todos de créditos ya finalizados, no afecta el piloto.</li>
          <li><b className="text-tinta">Acción / triage</b>: con el botón de cada fila marcás la divergencia como <i>en progreso</i>, <i>resuelta</i> o <i>aceptada</i> (baseline) con una nota. Una crítica marcada resuelta/aceptada deja de contar como "sin resolver" y el estado de arriba vuelve a verde. Queda la traza (quién, cuándo).</li>
          <li><b className="text-tinta">Kill switch</b>: congela TODAS las escrituras de plata al instante (sin redeploy) si detectás corrupción. Reactivalo cuando esté resuelto.</li>
          <li>Corrida manual y exhaustiva: <code className="rounded bg-suave px-1 py-0.5 text-[11px]">node --env-file=.env.local scripts/reconciliacion.mjs</code></li>
          <li>Comparar vs Disapp (shadow-mode): <code className="rounded bg-suave px-1 py-0.5 text-[11px]">python scripts/shadow-disapp.py</code></li>
        </ul>
      </section>
    </div>
  );
}

function Kpi({ label, valor, chico, ancho }: { label: string; valor: string; chico?: boolean; ancho?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta px-3.5 py-3 ${ancho ? "col-span-2 sm:col-span-2" : ""}`}>
      <span className="text-[11px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span className={`${chico ? "text-[15px]" : "text-[20px]"} font-black tabular-nums text-tinta`}>{valor}</span>
    </div>
  );
}

// "Cierre del día" — foto operativa para el dueño ocupado. Junta:
//  · Resumen del día (recaudado, cobros, colocado, neto de caja).
//  · Tablero EN VIVO por cobrador (rindió/entregó vs en ruta).  [1.3]
//  · Alertas que importan: faltantes de caja, sin rendir, mora crítica.  [1.2 interno]
//  · Proyección del mes ("a este ritmo llegás a X").  [1.4]
// Solo gestores. Todo LECTURA, reusa la capa de datos ya testeada.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getResumenPeriodo } from "@/lib/data/periodo";
import { getResumenCaja } from "@/lib/data/caja";
import { getRecaudoHoy } from "@/lib/data/recaudoHoy";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { getTableroMora } from "@/lib/data/mora";
import { getMetaMensual } from "@/lib/data/metaOperacion";
import { hoyUY, diasCobrablesDelMes } from "@/lib/fecha";
import { UYU, meses, diasSemana } from "@/lib/format";
import { EditorMeta } from "@/components/admin/EditorMeta";
import { ActivarAvisos } from "@/components/pwa/ActivarAvisos";

export const dynamic = "force-dynamic";

export default async function CierrePage() {
  // Foto operativa del DUEÑO (recaudo/proyección/meta globales). Solo admin: el
  // supervisor tiene su cierre acotado a la zona en /admin/caja (Cierre por zona).
  await requireAdmin();
  const db = await createSupabaseServer();

  const [dia, mes, caja, rend, mora, meta, rec] = await Promise.all([
    getResumenPeriodo(db, "dia"),
    getResumenPeriodo(db, "mes"),
    getResumenCaja(db, "hoy"),
    getRendicionesDia(db),
    getTableroMora(db),
    getMetaMensual(db),
    getRecaudoHoy(db),
  ]);

  const hoy = hoyUY();
  const fechaTitulo = `${diasSemana[hoy.getDay()]} ${hoy.getDate()} de ${meses[hoy.getMonth()]}`;

  // Proyección lineal del mes en días de COBRO (Lun–Sáb): no se cobra domingos,
  // así que extrapolar por días calendario distorsionaría el ritmo.
  const { transcurridos: diasCobrados, total: diasCobrablesMes } = diasCobrablesDelMes(hoy);
  const proyeccionMes =
    diasCobrados > 0 ? Math.round((mes.recaudado / diasCobrados) * diasCobrablesMes) : mes.recaudado;

  // Meta mensual (0 = sin fijar): avance real + si la proyección la alcanza.
  const avancePct = meta > 0 ? Math.round((mes.recaudado / meta) * 100) : null;
  const proyAlcanzaMeta = meta > 0 && proyeccionMes >= meta;
  const brechaMeta = proyeccionMes - meta;

  const faltantes = rend.rendidas.filter((r) => r.diferencia < 0);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Cierre del día</h1>
          <span className="text-[13px] font-medium text-gris capitalize">{fechaTitulo}</span>
        </div>
        {/* Avisos push en este dispositivo (cierre + alertas críticas). */}
        <ActivarAvisos vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </div>

      {/* Resumen del día */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Recaudado hoy" valor={UYU(rec.total)} sub={`${rec.cobros} cobros · ${rec.cobradores} cobradores`} fuerte />
        <Kpi label="Colocado hoy" valor={UYU(dia.colocado)} sub={`${dia.creditosNuevos} créditos`} />
        <Kpi label="Neto de caja hoy" valor={UYU(caja.neto)} sub={`contable · egresos ${UYU(caja.egresosTotal)}`} alerta={caja.neto < 0} />
        <Kpi label="Ticket promedio" valor={UYU(dia.ticketPromedio)} sub="por cobro" />
      </div>

      {/* Explicación del número más sensible del día: 100% verídico, del libro inmutable. */}
      <div className="rounded-[14px] border border-borde bg-suave p-4">
        <p className="text-[12.5px] font-extrabold text-tinta">Cómo se calcula "Recaudado hoy" (es exacto)</p>
        <p className="mt-1 text-[12px] leading-[1.6] font-medium text-gris">
          Es la suma de <b>todos los cobros registrados hoy</b> (día de Uruguay, de medianoche hasta ahora),
          tomada del <b>libro de pagos inmutable</b>: no se estima ni se puede editar — un pago solo se{" "}
          <b>anula</b> dejando registro de quién y por qué. Es autoritativo del servidor, no del teléfono del cobrador.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Desglose label="En ruta (créditos activos)" valor={rec.enRuta} sub={`${rec.cobrosRuta} cobros`} tono="#157A50" />
          <Desglose label="En créditos ya cerrados" valor={rec.enCerrados} sub={`${rec.cobrosCerrados} cobros`} tono="#B9770E" />
        </div>
        {rec.enCerrados > 0 && (
          <p className="mt-2 text-[11.5px] leading-[1.5] font-medium text-tenue">
            Del total, <b>{UYU(rec.enCerrados)}</b> son pagos de hoy sobre créditos ya finalizados/históricos
            (cuotas que cerraron un crédito o referencias que el sistema aún no re-vinculó a un crédito activo). Por
            eso el <Link href="/admin/cobranza" className="font-bold text-azul">mapa de Cobranza</Link> —que solo
            mira la ruta activa— muestra {UYU(rec.enRuta)}, no el total del día.
          </p>
        )}
      </div>

      {/* Alertas que importan (clickeables donde se puede actuar) */}
      {(faltantes.length > 0 || rend.pendientes.length > 0 || mora.resumen.critico > 0) && (
        <div className="flex flex-col gap-2">
          {faltantes.length > 0 && (
            <Alerta
              tono="rojo"
              titulo={`${faltantes.length} faltante${faltantes.length === 1 ? "" : "s"} de caja`}
              href="/admin/alertas"
              nota="Entregó MENOS de lo esperado (recaudado − gastos). Qué pasa: el faltante queda registrado, BAJA el score de confianza del cobrador y suma a su cuenta corriente. Tocá para ver su historial de confianza y decidir (hablar, recuperar, descontar) en el Centro de alertas."
            >
              <ListaAlerta
                items={faltantes.map((f) => ({
                  nombre: f.cobradorNombre ?? "Cobrador",
                  valor: `falta ${UYU(Math.abs(f.diferencia))}`,
                  tono: "#C0392B",
                }))}
              />
            </Alerta>
          )}
          {rend.pendientes.length > 0 && (
            <Alerta
              tono="ambar"
              titulo={`${rend.pendientes.length} cobrador${rend.pendientes.length === 1 ? "" : "es"} sin rendir`}
              href="/admin/alertas"
              nota="Recaudaron en la calle pero todavía no cerraron su jornada: ese efectivo (float) aún no entró a la caja. Si persiste, sube la exposición y baja la confianza del cobrador. Seguilo en el Centro de alertas."
            >
              <ListaAlerta
                items={rend.pendientes.map((p) => ({
                  nombre: p.nombre,
                  valor: `${UYU(p.recaudado)} en mano`,
                  tono: "#B9770E",
                }))}
              />
            </Alerta>
          )}
          {mora.resumen.critico > 0 && (
            <Alerta
              tono="rojo"
              titulo={`${mora.resumen.critico} crédito${mora.resumen.critico === 1 ? "" : "s"} en mora crítica`}
              href="/admin/mora"
              nota="Mora crítica = 16+ días de atraso: el capital MÁS en riesgo. Tocá para ver la lista priorizada y disparar la cobranza."
            >
              {`${mora.resumen.alto} en alerta alta · deuda vencida en TODA la cartera en riesgo (crítico+alto+medio): ${UYU(mora.resumen.deudaEnRiesgo)}`}
            </Alerta>
          )}
        </div>
      )}

      {/* Tablero en vivo por cobrador */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-tinta">En vivo por cobrador</span>
          {rend.disponible && (
            <span className="text-[12px] font-medium text-gris">
              Entregado: {UYU(rend.totalEntregado)}
            </span>
          )}
        </div>
        <p className="mb-3 text-[11.5px] leading-[1.55] font-medium text-gris">
          Cada cobrador con lo que <b>recaudó hoy</b> (del libro de pagos) y su estado de cierre de jornada:{" "}
          <b className="text-[#157A50]">Cuadra</b> (entregó lo esperado),{" "}
          <b className="text-[#C0392B]">Faltante</b> / <b className="text-azul">Sobrante</b> (diferencia al rendir), o{" "}
          <b className="text-gris">En ruta</b> (todavía no cerró: el efectivo sigue en la calle). El "esperado" =
          recaudado − gastos de ruta declarados.
        </p>

        {dia.porCobrador.length === 0 ? (
          <p className="py-6 text-center text-[13px] font-medium text-gris">
            Todavía no hay cobros registrados hoy.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dia.porCobrador.map((c) => {
              const rendido = rend.rendidas.find((r) => r.cobradorId === c.cobradorId);
              return (
                <li
                  key={c.cobradorId}
                  className="flex items-center gap-3 rounded-[12px] border border-linea bg-suave px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#2453DC] text-[13px] font-black text-white">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-bold text-tinta">{c.nombre}</span>
                    <span className="text-[11.5px] font-medium text-gris tabular-nums">
                      {UYU(c.recaudado)} · {c.cobros} cobros
                    </span>
                  </div>
                  <EstadoCobrador rendido={rendido} disponible={rend.disponible} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Proyección del mes + meta */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-extrabold text-tinta">Proyección del mes</span>
          <EditorMeta meta={meta} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label={`Recaudado (${mes.etiqueta})`} valor={UYU(mes.recaudado)} />
          <Kpi
            label="Vs mes anterior"
            valor={mes.variacionPct == null ? "—" : `${mes.variacionPct >= 0 ? "+" : ""}${Math.round(mes.variacionPct * 100)}%`}
            alerta={mes.variacionPct != null && mes.variacionPct < 0}
          />
          <Kpi label="Ritmo diario" valor={UYU(Math.round(mes.recaudado / Math.max(1, diasCobrados)))} sub="por día de cobro" />
          <Kpi label="Proyección fin de mes" valor={UYU(proyeccionMes)} sub={`${diasCobrados}/${diasCobrablesMes} días de cobro`} fuerte />
        </div>

        {meta > 0 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
              <span className="text-gris">
                Meta del mes: <b className="text-tinta tabular-nums">{UYU(meta)}</b>
              </span>
              <span className={proyAlcanzaMeta ? "text-verde" : "text-[#B9770E]"}>
                {proyAlcanzaMeta
                  ? `A este ritmo la superás por ${UYU(brechaMeta)} 🎯`
                  : `A este ritmo te faltarían ${UYU(-brechaMeta)}`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-linea">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, avancePct ?? 0)}%`,
                  background: proyAlcanzaMeta ? "linear-gradient(90deg,#34E0A1,#1FA971)" : "#E8A317",
                }}
              />
            </div>
            <span className="text-[11px] font-medium text-gris tabular-nums">
              Vas al {avancePct}% de la meta ({UYU(mes.recaudado)} de {UYU(meta)}).
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[11.5px] font-medium text-tenue">
            Fijá una meta mensual para ver tu avance y si vas a llegar. Proyección lineal: mantené el
            ritmo diario del mes. Es una estimación, no un compromiso.
          </p>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  valor,
  sub,
  fuerte,
  alerta,
}: {
  label: string;
  valor: string;
  sub?: string;
  fuerte?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="text-[11px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span
        className={`mt-1 text-[19px] font-extrabold tabular-nums ${
          alerta ? "text-[#C0392B]" : fuerte ? "text-azul" : "text-tinta"
        }`}
      >
        {valor}
      </span>
      {sub && <span className="text-[11px] font-medium text-tenue">{sub}</span>}
    </div>
  );
}

function Desglose({ label, valor, sub, tono }: { label: string; valor: number; sub: string; tono: string }) {
  return (
    <div className="flex flex-col rounded-[10px] border border-borde bg-tarjeta px-3 py-2">
      <span className="text-[10.5px] font-semibold text-tenue">{label}</span>
      <span className="text-[15px] font-extrabold tabular-nums" style={{ color: tono }}>{UYU(valor)}</span>
      <span className="text-[10px] font-medium text-[#AEB6CC]">{sub}</span>
    </div>
  );
}

/** Lista de la alerta como FILAS (nombre a la izquierda, monto a la derecha).
 *  Mucho más legible que un run-on de nombres. Corta en `max` con "…y N más". */
function ListaAlerta({
  items,
  max = 6,
}: {
  items: { nombre: string; valor: string; tono?: string }[];
  max?: number;
}) {
  const visibles = items.slice(0, max);
  const resto = items.length - visibles.length;
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {visibles.map((it, i) => (
        <div key={i} className="flex items-center justify-between gap-3 border-t border-black/5 py-1 first:border-t-0">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-tinta">{it.nombre}</span>
          <span className="flex-shrink-0 text-[12px] font-extrabold tabular-nums" style={{ color: it.tono ?? "#6B7494" }}>
            {it.valor}
          </span>
        </div>
      ))}
      {resto > 0 && <span className="pt-0.5 text-[11px] font-bold text-tenue">…y {resto} más</span>}
    </div>
  );
}

function Alerta({
  tono,
  titulo,
  children,
  href,
  nota,
}: {
  tono: "rojo" | "ambar";
  titulo: string;
  children: React.ReactNode;
  /** Si viene, la alerta es un enlace a donde se actúa. */
  href?: string;
  /** Explicación corta de qué es y qué hacer. */
  nota?: string;
}) {
  const c =
    tono === "rojo"
      ? { bg: "#FBE9E7", bd: "#F3C0B8", fg: "#C0392B" }
      : { bg: "#FDF3E2", bd: "#F0D9A8", fg: "#B9770E" };
  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold" style={{ color: c.fg }}>
          {titulo}
        </span>
        {href && (
          <span className="flex-shrink-0 text-[11.5px] font-bold" style={{ color: c.fg }}>
            Ver y actuar →
          </span>
        )}
      </div>
      <div className="text-[12px] font-medium text-gris">{children}</div>
      {nota && <span className="mt-0.5 text-[11px] font-medium text-tenue">{nota}</span>}
    </>
  );
  const clase = "flex flex-col gap-0.5 rounded-[12px] border px-3.5 py-2.5";
  const estilo = { background: c.bg, borderColor: c.bd };
  return href ? (
    <Link href={href} className={`${clase} transition-shadow hover:shadow-[0_2px_10px_rgba(0,0,0,0.08)]`} style={estilo}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clase} style={estilo}>
      {cuerpo}
    </div>
  );
}

function EstadoCobrador({
  rendido,
  disponible,
}: {
  rendido: { entregado: number; diferencia: number; estado: string } | undefined;
  disponible: boolean;
}) {
  if (!disponible) return null;
  if (!rendido) {
    return (
      <span className="flex-shrink-0 rounded-full bg-[#F1F3F9] px-2.5 py-1 text-[11px] font-bold text-gris">
        En ruta
      </span>
    );
  }
  const c =
    rendido.estado === "cuadra"
      ? { bg: "#E4F5EC", fg: "#157A50", txt: "Cuadra" }
      : rendido.estado === "faltante"
        ? { bg: "#FBE4E2", fg: "#C0392B", txt: `Faltante ${UYU(rendido.diferencia)}` }
        : { bg: "#EAF0FF", fg: "#1E47C8", txt: `Sobrante ${UYU(rendido.diferencia)}` };
  return (
    <span
      className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ background: c.bg, color: c.fg }}
    >
      {c.txt}
    </span>
  );
}

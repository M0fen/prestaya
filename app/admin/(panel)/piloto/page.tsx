// ─────────────────────────────────────────────────────────────────────────
//  PANEL DEL PILOTO (solo dev). Lo que hay que tener en cuenta, en un solo
//  lugar y en este orden: ¿está sano? (semáforo) → ¿lo usan? (adopción, 14
//  días) → ¿la plata está cuidada? → ¿cómo va el espejo con Disapp? →
//  ¿qué hay que decidir? (pendientes editables) → ¿cómo llegamos acá? (hitos).
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { requireDev } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getPanelPiloto } from "@/lib/data/piloto";
import { BUILD } from "@/lib/build-info";
import { EMPALMES } from "@/lib/piloto/empalmes";
import { HITOS, type TonoHito } from "@/lib/piloto/hitos";
import { hace } from "@/lib/enVivo/clasificar";
import { UYU } from "@/lib/format";
import { BarrasDias } from "@/components/admin/BarrasDias";
import { PilotoPendientes } from "@/components/admin/PilotoPendientes";

export const dynamic = "force-dynamic";

type Estado = "ok" | "atencion" | "critico" | "neutro";
const TONO: Record<Estado, { bg: string; fg: string; borde: string }> = {
  ok: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)", borde: "transparent" },
  atencion: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", borde: "transparent" },
  critico: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)", borde: "var(--color-rojo-osc)" },
  neutro: { bg: "var(--color-tarjeta)", fg: "var(--color-tinta)", borde: "var(--color-borde)" },
};
const TONO_HITO: Record<TonoHito, { fg: string; label: string }> = {
  avance: { fg: "var(--color-verde-osc)", label: "avance" },
  incidente: { fg: "var(--color-rojo-osc)", label: "incidente" },
  regla: { fg: "var(--color-azul)", label: "regla" },
  deploy: { fg: "var(--color-ambar-osc)", label: "deploy" },
};

const fechaHora = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : "—";
const fechaCorta = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const n = (v: number) => v.toLocaleString("es-UY");

export default async function PilotoPage() {
  await requireDev();
  const alcance = await alcanceDelActor();
  const d = await getPanelPiloto(alcance);
  // "hace X" se mide contra el instante de la foto (no Date.now() en el render:
  // la regla de pureza del compilador de React, y además es la verdad de la foto).
  const ahora = new Date(d.generadoEn).getTime();
  const ultimo = EMPALMES[EMPALMES.length - 1];
  const pctExactos = ultimo.exactos + ultimo.cortos + ultimo.pasados > 0 ? Math.round((ultimo.exactos / (ultimo.exactos + ultimo.cortos + ultimo.pasados)) * 100) : 0;
  const abiertos = d.pendientes.filter((p) => p.estado === "abierto" || p.estado === "en_progreso");
  const altas = abiertos.filter((p) => p.prioridad === "alta").length;
  const respaldoHoras = d.salud.respaldo?.horas ?? null;
  const cobrandoHoy = d.series.cobradores[d.series.cobradores.length - 1]?.valor ?? 0;
  const cobradores = d.equipo.length;
  const sinCobrar7 = d.equipo.filter((c) => c.cobros7 === 0);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Panel del piloto</h1>
          <span className="text-[13px] font-medium text-gris">
            Lo que hay que tener en cuenta, en un solo lugar. Foto de {fechaHora(d.generadoEn)} · día {fechaCorta(d.hoy)}.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
          <Link href="/admin/en-vivo" className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-gris hover:text-tinta">🟢 En vivo</Link>
          <Link href="/admin/uso" className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-gris hover:text-tinta">🕵️ Adopción</Link>
          <Link href="/admin/empalme" className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-gris hover:text-tinta">🔗 Empalme</Link>
        </div>
      </header>

      {d.caidas.length > 0 && (
        <p className="rounded-[12px] border px-4 py-2.5 text-[12px] font-bold" style={{ borderColor: "var(--color-ambar-osc)", background: "var(--color-ambar-suave)", color: "var(--color-ambar-osc)" }}>
          ⚠️ Fuentes que no respondieron a tiempo (se muestran en cero): {d.caidas.join(" · ")}
        </p>
      )}

      {/* ── 1 · SEMÁFORO ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">¿Está sano?</h2>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Tile
            estado="neutro"
            label="Build en prod"
            valor={BUILD.shaCorto ?? "?"}
            sub={BUILD.fechaCommit ? `${hace(BUILD.fechaCommit, ahora)} · ${BUILD.rama ?? ""}${BUILD.sucio ? " · con cambios sin commitear" : ""}` : "sin build-info"}
            titulo={BUILD.mensaje ?? undefined}
          />
          <Tile
            estado={d.salud.cron.caido ? "critico" : (d.salud.cron.ultima?.criticos ?? 0) > 0 ? "atencion" : "ok"}
            label="Vigilante (reconciliación)"
            valor={d.salud.cron.ultima ? `${d.salud.cron.ultima.criticos} críticas` : "nunca corrió"}
            sub={d.salud.cron.ultima ? `corrió ${hace(d.salud.cron.ultima.corridaEn, ahora)} · ${d.salud.cron.ultima.total} dif. en total` : "CRON_SECRET en Vercel"}
            href="/admin/empalme"
          />
          <Tile
            estado={respaldoHoras === null ? "critico" : respaldoHoras > 24 * 7 ? "critico" : respaldoHoras > 24 ? "atencion" : "ok"}
            label="Respaldo verificado"
            valor={respaldoHoras === null ? "ninguno" : respaldoHoras < 24 ? `hace ${Math.round(respaldoHoras)} h` : `hace ${Math.round(respaldoHoras / 24)} d`}
            sub={d.salud.respaldo ? `${n(d.salud.respaldo.filas)} filas · ${(d.salud.respaldo.bytes / 1024 / 1024).toFixed(1)} MB` : "backup-completo.mjs + verificar-backup.mjs"}
            href="/admin/empalme"
          />
          <Tile
            estado={d.salud.congelado ? "critico" : "ok"}
            label="Kill switch"
            valor={d.salud.congelado ? "PLATA CONGELADA" : "escritura abierta"}
            sub={d.salud.congelado ? "ningún cobro entra hasta reactivar" : "modo_solo_lectura apagado"}
            href="/admin/empalme"
          />
          <Tile
            estado={pctExactos >= 90 ? "ok" : pctExactos >= 80 ? "atencion" : "critico"}
            label="Espejo con Disapp"
            valor={`${pctExactos}% exactos`}
            sub={`empalme del ${fechaCorta(ultimo.fecha)} · ${ultimo.cortos} cortos · ${ultimo.pasados} pasados · ${ultimo.noEstanEnApp} sin cargar`}
            href="#espejo"
          />
          <Tile
            estado={d.plata.sinRuta.n > 0 ? "critico" : "ok"}
            label="Plata fuera de toda ruta"
            valor={d.plata.sinRuta.n > 0 ? UYU(d.plata.sinRuta.monto) : "$0"}
            sub={d.plata.sinRuta.n > 0 ? `${d.plata.sinRuta.n} clientes con crédito vivo que nadie ve` : "todo crédito activo está en una ruta"}
            href="/admin/operacion"
          />
          <Tile
            estado={d.salud.incidenciasAbiertas > 0 ? "atencion" : "ok"}
            label="Incidencias abiertas"
            valor={String(d.salud.incidenciasAbiertas)}
            sub={d.incidencias[0] ? `última: ${d.incidencias[0].descripcion.slice(0, 60)}` : "reportadas desde la app (🐞)"}
            href="/admin/incidencias"
          />
          <Tile
            estado={altas > 0 ? "atencion" : "neutro"}
            label="Pendientes abiertos"
            valor={String(abiertos.length)}
            sub={`${altas} de prioridad alta · ${UYU(abiertos.reduce((s, p) => s + (p.monto ?? 0), 0))} en juego`}
            href="#pendientes"
          />
        </div>
      </section>

      {/* ── 2 · ADOPCIÓN ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
          <h2 className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">¿Lo usan? · últimos 14 días, solo lo NATIVO de la app</h2>
          <span className="text-[12px] font-medium text-gris">
            hoy cobran por la app <b className="text-tinta">{cobrandoHoy}</b> de {cobradores} cobradores
          </span>
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          <BarrasDias titulo="Recaudo nativo por día" serie={d.series.recaudo} formato={UYU} color="var(--color-verde)" />
          <BarrasDias titulo="Cobros registrados por día" serie={d.series.cobros} formato={n} />
          <BarrasDias titulo="Cobradores que cobraron por la app" serie={d.series.cobradores} formato={n} nota={`de ${cobradores} activos`} />
          <BarrasDias titulo="Capital colocado desde la app" serie={d.series.colocado} formato={UYU} color="var(--color-azul-osc)" />
          <BarrasDias titulo="Actas de cierre de caja" serie={d.series.actas} formato={n} color="var(--color-ambar)" nota="sin acta no hay arrastre de caja: cada uno amanece en $0" />
          <BarrasDias titulo="Bases de caja cargadas" serie={d.series.bases} formato={n} color="var(--color-ambar)" nota="las carga el supervisor en Mi jornada" />
        </div>

        <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-3 py-2.5">Cobrador · última semana</th>
                <th className="px-3 py-2.5">Zona</th>
                <th className="px-3 py-2.5 text-right">Cobros</th>
                <th className="px-3 py-2.5 text-right">Recaudo</th>
                <th className="px-3 py-2.5 text-right">Días</th>
                <th className="px-3 py-2.5">Último cobro</th>
                <th className="px-3 py-2.5">Última acta</th>
                <th className="px-3 py-2.5">Última base</th>
              </tr>
            </thead>
            <tbody>
              {d.equipo.map((c) => (
                <tr key={c.id} className="border-b border-linea last:border-0" style={c.cobros7 === 0 ? { background: "var(--color-rojo-suave)" } : undefined}>
                  <td className="px-3 py-2 font-bold text-tinta">
                    <Link href={`/admin/cobrador/${c.id}`} className="hover:underline">{c.nombre}</Link>
                  </td>
                  <td className="px-3 py-2 text-gris">{c.zona?.replace("Zona ", "") ?? "— sin zona"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.cobros7}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-tinta">{UYU(c.recaudo7)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.diasActivos7}/6</td>
                  <td className="px-3 py-2 text-gris tabular-nums">{c.ultimoCobro ? hace(c.ultimoCobro, ahora) : "nunca en 14 d"}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: c.ultimaActa ? "var(--color-verde-osc)" : "var(--color-rojo-osc)" }}>
                    {c.ultimaActa ? fechaCorta(c.ultimaActa) : "ninguna en 14 d"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gris">{c.ultimaBase ? fechaCorta(c.ultimaBase) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sinCobrar7.length > 0 && (
            <p className="border-t border-linea px-3 py-2 text-[11.5px] font-medium text-gris">
              En rojo, {sinCobrar7.length} sin un solo cobro por la app en la semana: es adopción, no abandono — se resuelve acompañando, no llamando.
            </p>
          )}
        </div>
      </section>

      {/* ── 3 · PLATA ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">¿La plata está cuidada?</h2>
        <div className="grid gap-2.5 md:grid-cols-2">
          <Bloque titulo={`Cobradores en silencio ≥ 3 días (${d.plata.silencio.n}) · ${UYU(d.plata.silencio.monto)} sin mirar`} href="/admin/operacion">
            {d.plata.silencio.lista.length === 0 ? (
              <p className="text-[12.5px] font-medium text-gris">Nadie con cartera lleva 3 días sin cobrar.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {d.plata.silencio.lista.map((c) => (
                  <li key={c.nombre} className="flex justify-between gap-2 tabular-nums">
                    <span className="min-w-0 truncate font-bold text-tinta">{c.nombre}</span>
                    <span className="flex-shrink-0 text-gris">{c.dias} d · {UYU(c.monto)}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.plata.nuncaCobraron.n > 0 && (
              <p className="mt-2 text-[11.5px] font-medium text-tenue">
                Además {d.plata.nuncaCobraron.n} con clientes asignados que nunca cobraron por la app ({UYU(d.plata.nuncaCobraron.monto)}).
              </p>
            )}
          </Bloque>
          <Bloque titulo="Cosas esperando una mano">
            <ul className="flex flex-col gap-1.5 text-[12.5px] font-medium text-cuerpo">
              <Fila label="Gastos de ruta por aprobar" valor={String(d.plata.gastosPendientes)} href="/admin/gastos" alerta={d.plata.gastosPendientes > 0} />
              <Fila label="Correcciones de cobro por avalar" valor={String(d.plata.anulacionesPendientes)} href="/admin/anulaciones" alerta={d.plata.anulacionesPendientes > 0} />
              <Fila label="Jornadas con cobros y sin acta (14 d)" valor={String(d.plata.jornadasSinActa14)} href="/admin/caja" alerta={d.plata.jornadasSinActa14 > 0} />
              <Fila label="Clientes con crédito vivo fuera de toda ruta" valor={`${d.plata.sinRuta.n} · ${UYU(d.plata.sinRuta.monto)}`} href="/admin/operacion" alerta={d.plata.sinRuta.n > 0} />
              <Fila label="Incidencias abiertas" valor={String(d.salud.incidenciasAbiertas)} href="/admin/incidencias" alerta={d.salud.incidenciasAbiertas > 0} />
            </ul>
            {d.plata.sinRuta.nombres.length > 0 && (
              <p className="mt-2 text-[11.5px] font-medium text-tenue">{d.plata.sinRuta.nombres.join(" · ")}</p>
            )}
          </Bloque>
        </div>
      </section>

      {/* ── 4 · ESPEJO CON DISAPP ──────────────────────────────────────── */}
      <section id="espejo" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
          <h2 className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Espejo con Disapp · cada empalme</h2>
          <span className="text-[11.5px] font-medium text-tenue">
            medido con <code className="rounded bg-suave px-1">scripts/verificar-post-empalme.py</code>; se anota a mano tras cada corrida
          </span>
        </div>
        <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-3 py-2.5">Export</th>
                <th className="px-3 py-2.5 text-right">Activos app / Disapp</th>
                <th className="px-3 py-2.5 text-right">Exactos</th>
                <th className="px-3 py-2.5 text-right">Cortos</th>
                <th className="px-3 py-2.5 text-right">Pasados</th>
                <th className="px-3 py-2.5 text-right">Sin cargar</th>
                <th className="px-3 py-2.5">Notas</th>
              </tr>
            </thead>
            <tbody>
              {[...EMPALMES].reverse().map((e) => {
                const tot = e.exactos + e.cortos + e.pasados;
                return (
                  <tr key={e.fecha} className="border-b border-linea align-top last:border-0">
                    <td className="px-3 py-2 font-bold whitespace-nowrap text-tinta">{fechaCorta(e.fecha)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gris">{n(e.activosApp)} / {n(e.activosDisapp)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-verde-osc">{tot ? `${n(e.exactos)} (${Math.round((e.exactos / tot) * 100)}%)` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ambar-osc">{tot ? `${e.cortos}${e.montoCortos != null ? ` · ${UYU(e.montoCortos)}` : ""}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rojo-osc">{tot ? `${e.pasados}${e.montoPasados != null ? ` · ${UYU(e.montoPasados)}` : ""}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gris">{e.noEstanEnApp}</td>
                    <td className="px-3 py-2 text-[12px] leading-[1.45] text-gris">{e.notas}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 5 · PENDIENTES ─────────────────────────────────────────────── */}
      <PilotoPendientes pendientes={d.pendientes} hoy={d.hoy} />

      {/* ── 6 · HITOS ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="px-0.5 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Bitácora del piloto · cómo llegamos acá</h2>
        <ol className="flex flex-col gap-0 rounded-[16px] border border-borde bg-tarjeta px-4 py-2">
          {HITOS.map((h, i) => (
            <li key={`${h.fecha}-${i}`} className="grid grid-cols-[64px_1fr] gap-3 border-b border-linea py-3 last:border-0">
              <span className="pt-0.5 text-[12px] font-bold text-tenue tabular-nums">{fechaCorta(h.fecha)}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wide uppercase" style={{ color: TONO_HITO[h.tono].fg }}>{TONO_HITO[h.tono].label}</span>
                  <span className="text-[13.5px] font-extrabold text-tinta">{h.titulo}</span>
                  {h.commit && <code className="rounded bg-suave px-1.5 text-[10.5px] text-tenue">{h.commit}</code>}
                </span>
                <span className="text-[12.5px] leading-[1.5] font-medium text-gris">{h.detalle}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Tile({ estado, label, valor, sub, href, titulo }: { estado: Estado; label: string; valor: string; sub?: string; href?: string; titulo?: string }) {
  const t = TONO[estado];
  const inner = (
    <div className="flex h-full min-w-0 flex-col gap-0.5 rounded-[14px] border p-3.5" style={{ background: t.bg, borderColor: t.borde }} title={titulo}>
      <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: t.fg, opacity: 0.85 }}>{label}</span>
      <span className="truncate text-[18px] font-black tabular-nums" style={{ color: t.fg }}>{valor}</span>
      {sub && <span className="truncate text-[11px] font-medium" style={{ color: t.fg, opacity: 0.8 }}>{sub}</span>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function Bloque({ titulo, href, children }: { titulo: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-extrabold text-tinta">{titulo}</h3>
        {href && <Link href={href} className="text-[11.5px] font-bold text-azul">ver →</Link>}
      </div>
      {children}
    </section>
  );
}

function Fila({ label, valor, href, alerta }: { label: string; valor: string; href: string; alerta: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <Link href={href} className="min-w-0 truncate hover:underline">{label}</Link>
      <span className="flex-shrink-0 font-extrabold tabular-nums" style={{ color: alerta ? "var(--color-rojo-osc)" : "var(--color-verde-osc)" }}>{valor}</span>
    </li>
  );
}

// PERFIL OPERATIVO de un miembro del equipo (gestor). Reemplaza al modal que solo
// mostraba documento/teléfono/fechas: acá se ve el STATUS real — el recorrido que
// está haciendo hoy parada por parada, cómo viene la plata (base, cobrado, gastos,
// qué debería tener en mano), su paso por el campo y sus números del período.
// Alcance: admin ve a cualquiera; supervisor, solo a los cobradores de su zona.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getPerfilCobrador, type ParadaRuta } from "@/lib/data/perfilCobrador";
import { UYU, horaDe } from "@/lib/format";
import { linkWhatsApp } from "@/lib/telefono";
import { RestablecerAcceso } from "@/components/admin/RestablecerAcceso";

export const dynamic = "force-dynamic";

const ETIQUETA_ROL: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  cobrador: "Cobrador",
};

/** "hace 20 min" / "hace 2 h". Para saber si la persona se movió recién. */
function hace(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}

const ESTADO_PARADA: Record<string, { txt: string; bg: string; fg: string }> = {
  pagado: { txt: "Cobrado", bg: "#E4F5EC", fg: "#157A50" },
  abono: { txt: "Abonó", bg: "#FDF3E2", fg: "#9A6A0E" },
  no_pago: { txt: "No pagó", bg: "#FBE4E2", fg: "#C0392B" },
  pendiente: { txt: "Falta pasar", bg: "#EEF1F8", fg: "#6B7494" },
  sin_credito: { txt: "Sin crédito", bg: "#F1F3F9", fg: "#8A93AD" },
};

export default async function PerfilCobradorPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const usuario = await requireGestor();
  const admin = esAdmin(usuario.rol);

  // Alcance: un supervisor solo puede abrir la ficha de SU gente (server-side).
  const alcance = await alcanceDelActor();
  if (!alcance.global && !alcance.cobradorIds.includes(id) && id !== usuario.id) notFound();

  const db = await createSupabaseServer();
  const p = await getPerfilCobrador(db, id);
  if (!p) notFound();

  const { persona: q, arqueo, jornada } = p;
  const esCobrador = q.rol === "cobrador";
  // "En mano": lo que debería tener el cobrador ahora mismo (base + cobrado − gastos).
  const enMano = jornada.base + jornada.recaudado - p.gastos.total;
  const pct = arqueo.esperado > 0 ? Math.min(100, Math.round((arqueo.recaudadoRuta / arqueo.esperado) * 100)) : 0;
  const falta = Math.max(0, arqueo.esperado - arqueo.recaudadoRuta);
  const visitados = arqueo.cobrados + arqueo.abonos + arqueo.noPagos;
  const sinTocar = p.paradas.filter((x) => x.sinCuotaHoy).length;
  const fueraDeZona = p.paradas.filter((x) => x.enZona === false).length;
  const rend = jornada.yaRendida;

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      <Link href="/admin/equipo" className="text-[13px] font-semibold text-azul">
        ← Equipo
      </Link>

      {/* ── Cabecera ── */}
      <header className="flex flex-col gap-3 rounded-[18px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] bg-[#2453DC] text-[22px] font-black text-white">
            {(q.nombre || "?").charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-tinta">{q.nombre}</h1>
              {q.apodo && <span className="text-[13px] font-bold text-tenue">«{q.apodo}»</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip texto={q.esDev ? "Desarrollador" : ETIQUETA_ROL[q.rol] ?? q.rol} bg="#EAF0FF" fg="#1E47C8" />
              {q.zonaNombre && <Chip texto={q.zonaNombre} bg="#F1F3F9" fg="#4A5578" />}
              {!q.activo && <Chip texto="DE BAJA" bg="#FBE4E2" fg="#C0392B" />}
              {esCobrador && <Chip texto={`Comisión ${q.comisionPct}%`} bg="#F1F3F9" fg="#4A5578" />}
              <Chip
                texto={q.claveCambiadaEn ? "🔑 clave propia" : "🔑 clave de arranque"}
                bg={q.claveCambiadaEn ? "#E4F5EC" : "#FDF3E2"}
                fg={q.claveCambiadaEn ? "#157A50" : "#9A6A0E"}
              />
            </div>
            <span className="text-[12px] font-medium text-gris">
              {q.email ?? "sin email"} · último ingreso {hace(q.ultimoAccesoIso)}
            </span>
          </div>
          {q.telefono && (
            <a
              href={linkWhatsApp(q.telefono, `Hola ${q.nombre.split(/\s+/)[0]},`)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-3.5 py-2 text-[12.5px] font-extrabold text-white active:scale-95"
            >
              💬 <span className="hidden sm:inline">Escribirle</span>
            </a>
          )}
        </div>
      </header>

      {/* ── Deuda de ayer: lo primero que hay que resolver ── */}
      {p.deudaAyer && (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-[#F2C9C4] bg-[#FDECEA] px-4 py-3">
          <span className="text-[18px]" aria-hidden="true">⚠️</span>
          <span className="text-[13px] font-semibold text-[#A5342B]">
            No rindió el {p.deudaAyer.fecha}: quedaron <b>{UYU(p.deudaAyer.monto)}</b> de {p.deudaAyer.cobros} cobros sin entregar.
          </span>
        </div>
      )}

      {esCobrador && (
        <>
          {/* ── CÓMO VA EL DÍA ── */}
          <section className="flex flex-col gap-3 rounded-[18px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-[15px] font-extrabold text-tinta">Cómo va el día</h2>
              <span className="text-[11.5px] font-semibold text-tenue">
                {p.primerCobroIso
                  ? `arrancó ${horaDe(p.primerCobroIso)} · último cobro ${horaDe(p.ultimoCobroIso ?? p.primerCobroIso)} (${hace(p.ultimoCobroIso ?? p.primerCobroIso)})`
                  : "todavía sin cobros hoy"}
              </span>
            </div>

            {/* Avance de la cobranza */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[20px] font-extrabold text-tinta tabular-nums">
                  {UYU(arqueo.recaudadoRuta)}
                  <span className="text-[13px] font-bold text-tenue"> de {UYU(arqueo.esperado)}</span>
                </span>
                <span className={`text-[15px] font-extrabold tabular-nums ${pct >= 100 ? "text-[#157A50]" : "text-azul"}`}>
                  {pct}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#EEF1F8]">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, background: pct >= 100 ? "linear-gradient(90deg,#34E0A1,#1FA971)" : "linear-gradient(90deg,#2453DC,#1E47C8)" }}
                />
              </div>
              <span className="text-[12px] font-medium text-gris">
                {visitados} de {arqueo.clientes} clientes visitados
                {falta > 0 ? ` · faltan ${UYU(falta)}` : " · meta del día cubierta 🎉"}
              </span>
            </div>

            {/* Contadores del recorrido */}
            <div className="flex flex-wrap gap-1.5">
              <Cuenta n={arqueo.cobrados} txt="cobrados" bg="#E4F5EC" fg="#157A50" />
              <Cuenta n={arqueo.abonos} txt="abonos" bg="#FDF3E2" fg="#9A6A0E" />
              <Cuenta n={arqueo.noPagos} txt="no pagó" bg="#FBE4E2" fg="#C0392B" />
              <Cuenta n={arqueo.pendientes} txt="sin pasar" bg="#EEF1F8" fg="#4A5578" />
              {sinTocar > 0 && <Cuenta n={sinTocar} txt="hoy no toca" bg="#F1F3F9" fg="#8A93AD" />}
              {p.vencidos > 0 && <Cuenta n={p.vencidos} txt="a recuperar" bg="#F1F3F9" fg="#8A93AD" />}
            </div>

            {/* La plata del día */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile k="Base entregada" v={UYU(jornada.base)} nota={jornada.base === 0 ? "sin base" : undefined} />
              <Tile k="Cobrado hoy" v={UYU(jornada.recaudado)} nota={`${jornada.cobrosCantidad} cobros`} />
              <Tile k="Gastos de ruta" v={UYU(p.gastos.total)} nota={p.gastos.items.length ? `${p.gastos.items.length} ítems` : "sin gastos"} />
              <Tile k="Debería tener" v={UYU(enMano)} destacado />
            </div>

            {/* Rendición */}
            <div
              className={`flex flex-wrap items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-[12.5px] font-semibold ${
                rend
                  ? rend.estado === "cuadra"
                    ? "bg-[#E4F5EC] text-[#157A50]"
                    : "bg-[#FDF3E2] text-[#9A6A0E]"
                  : "bg-suave text-gris"
              }`}
            >
              {rend ? (
                <>
                  <span>✓ Rindió a las {horaDe(rend.creadoEn)} · entregó {UYU(rend.entregado)}</span>
                  <span className="font-extrabold">
                    {rend.estado === "cuadra"
                      ? "cuadró"
                      : rend.estado === "faltante"
                        ? `faltó ${UYU(Math.abs(rend.diferencia))}`
                        : `sobró ${UYU(rend.diferencia)}`}
                  </span>
                </>
              ) : (
                <span>⏳ Todavía no rindió la caja de hoy.</span>
              )}
            </div>
          </section>

          {/* ── EL RECORRIDO DE HOY ── */}
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2 px-1">
              <h2 className="text-[15px] font-extrabold text-tinta">Su recorrido de hoy</h2>
              <span className="text-[11.5px] font-semibold text-tenue">
                {p.paradas.length} clientes en la ruta
                {fueraDeZona > 0 ? ` · ${fueraDeZona} cobro(s) lejos de la casa` : ""}
              </span>
            </div>
            {p.paradas.length === 0 ? (
              <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
                No tiene clientes asignados.
                <br />
                <span className="text-[12px] text-tenue-2">Asignale cartera para que pueda arrancar.</span>
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
                {p.paradas.map((x, i) => (
                  <Parada key={x.clienteId} x={x} n={i + 1} />
                ))}
              </ul>
            )}
          </section>

          {/* ── EN EL CAMPO ── */}
          {p.campo && p.campo.eventos.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <h2 className="text-[15px] font-extrabold text-tinta">En el campo hoy</h2>
                {p.campo.senales.nivel !== "ok" && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      p.campo.senales.nivel === "alerta" ? "bg-[#FBE4E2] text-[#C0392B]" : "bg-[#FDF3E2] text-[#9A6A0E]"
                    }`}
                  >
                    {p.campo.senales.nivel === "alerta" ? "⚠️ Revisar" : "👀 Observar"} · {p.campo.senales.motivos.join(" · ")}
                  </span>
                )}
              </div>
              <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
                {p.campo.eventos.slice(0, 40).map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5 px-3.5 py-2">
                    <span className="w-11 flex-shrink-0 text-[11.5px] font-semibold text-tenue tabular-nums">{horaDe(e.serverTs)}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-tinta">
                      <b className="font-bold">{e.accion.replace(/_/g, " ")}</b>
                      {e.clienteNombre ? <span className="font-medium text-gris"> · {e.clienteNombre}</span> : null}
                    </span>
                    {e.enZona === false && <span className="flex-shrink-0 text-[11px] font-bold text-[#C0392B]">lejos</span>}
                    {e.gpsDenegado && <span className="flex-shrink-0 text-[11px] font-bold text-[#9A6A0E]">sin GPS</span>}
                    {e.monto != null && (
                      <span className="flex-shrink-0 text-[12.5px] font-extrabold text-tinta tabular-nums">{UYU(e.monto)}</span>
                    )}
                    {e.gpsLat != null && e.gpsLng != null && (
                      <a
                        href={`https://www.google.com/maps?q=${e.gpsLat},${e.gpsLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-[11px] font-bold text-azul"
                      >
                        mapa
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── SUS NÚMEROS ── */}
          {p.numeros && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-[15px] font-extrabold text-tinta">Sus números</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile k="Quincena · recaudado" v={UYU(p.numeros.quincenaRecaudado)} nota={`desde ${p.numeros.quincenaDesde}`} />
                <Tile k="Quincena · comisión" v={UYU(p.numeros.comisionQuincena)} nota={`${p.numeros.comisionPct}%`} destacado />
                <Tile k="Mes · recaudado" v={UYU(p.numeros.mesRecaudado)} nota={`${p.numeros.mesCobros} cobros · ${p.numeros.mesDiasActivos} días`} />
                <Tile
                  k="Jornadas cuadradas"
                  v={`${p.numeros.cuadradas}/${p.numeros.rendiciones}`}
                  nota={p.numeros.rendiciones === 0 ? "sin rendiciones" : undefined}
                />
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Atajos + datos + acceso ── */}
      <section className="flex flex-col gap-3 rounded-[18px] border border-borde bg-tarjeta p-4">
        <h2 className="text-[15px] font-extrabold text-tinta">Ver más de {q.nombre.split(/\s+/)[0]}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Atajo href={`/admin/recaudos?vendedor=${q.id}`} txt="🧾 Sus cobros" />
          <Atajo href={`/admin/informe-cartera?vendedor=${q.id}`} txt="📁 Su cartera" />
          <Atajo href={`/admin/mora?cob=${q.id}`} txt="⚠️ Su mora" />
          <Atajo href={`/admin/uso?u=${q.id}`} txt="🕵️ Su uso de la app" />
          <Atajo href="/admin/campo" txt="🗺️ Control de campo" />
        </div>
        <dl className="flex flex-col divide-y divide-linea">
          <Fila k="Documento" v={q.documento ?? "—"} />
          <Fila k="Teléfono" v={q.telefono ?? "—"} />
          <Fila k="En el equipo desde" v={fechaCorta(q.creadoEnIso)} />
          <Fila k="Puso su contraseña" v={q.claveCambiadaEn ? fechaCorta(q.claveCambiadaEn) : "todavía usa la de arranque"} />
        </dl>
        {(admin || (usuario.rol === "supervisor" && q.rol === "cobrador")) && (
          <div className="border-t border-linea pt-3">
            <RestablecerAcceso usuarioId={q.id} nombre={q.nombre} telefono={q.telefono} />
          </div>
        )}
      </section>
    </div>
  );
}

function Parada({ x, n }: { x: ParadaRuta; n: number }) {
  const e = x.sinCuotaHoy
    ? { txt: "Hoy no toca", bg: "#F1F3F9", fg: "#8A93AD" }
    : x.plazoVencido
      ? { txt: "A recuperar", bg: "#F1F3F9", fg: "#8A93AD" }
      : ESTADO_PARADA[x.estadoHoy] ?? ESTADO_PARADA.pendiente;
  const pendiente = !x.sinCuotaHoy && !x.plazoVencido && (x.estadoHoy === "pendiente" || x.estadoHoy === "abono");
  return (
    <li className={`flex items-center gap-3 px-3.5 py-2.5 ${pendiente ? "bg-[#FCFDFF]" : ""}`}>
      <span className="w-6 flex-shrink-0 text-right text-[11.5px] font-bold text-tenue-2 tabular-nums">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-bold text-tinta">{x.nombre}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] font-medium text-tenue tabular-nums">
          {x.cuota > 0 && <span>cuota {UYU(x.cuota)}</span>}
          {x.pagadoHoy > 0 && <span className="font-bold text-[#157A50]">cobró {UYU(x.pagadoHoy)}</span>}
          {x.recuperadoHoy > 0 && <span className="font-bold text-[#157A50]">recuperó {UYU(x.recuperadoHoy)}</span>}
          {x.cobradoEn && <span>{horaDe(x.cobradoEn)}</span>}
          {x.enZona === false && <span className="font-bold text-[#C0392B]">lejos de la casa</span>}
        </span>
      </div>
      <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: e.bg, color: e.fg }}>
        {e.txt}
      </span>
    </li>
  );
}

function Chip({ texto, bg, fg }: { texto: string; bg: string; fg: string }) {
  return (
    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: bg, color: fg }}>
      {texto}
    </span>
  );
}

function Cuenta({ n, txt, bg, fg }: { n: number; txt: string; bg: string; fg: string }) {
  return (
    <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold tabular-nums" style={{ background: bg, color: fg }}>
      {n} {txt}
    </span>
  );
}

function Tile({ k, v, nota, destacado }: { k: string; v: string; nota?: string; destacado?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-[14px] px-3.5 py-2.5 ${destacado ? "bg-azul-suave" : "bg-suave"}`}>
      <span className="text-[10.5px] font-bold tracking-wide text-tenue uppercase">{k}</span>
      <span className={`text-[16px] font-extrabold tabular-nums ${destacado ? "text-azul" : "text-tinta"}`}>{v}</span>
      {nota && <span className="truncate text-[10.5px] font-medium text-tenue-2">{nota}</span>}
    </div>
  );
}

function Atajo({ href, txt }: { href: string; txt: string }) {
  return (
    <Link href={href} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12.5px] font-bold text-gris hover:border-azul hover:text-azul">
      {txt}
    </Link>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-[12px] font-medium text-gris">{k}</dt>
      <dd className="text-right text-[13px] font-semibold text-tinta">{v}</dd>
    </div>
  );
}

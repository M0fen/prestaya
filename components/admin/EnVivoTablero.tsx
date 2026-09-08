"use client";
// ─────────────────────────────────────────────────────────────────────────
//  TABLERO EN VIVO (dev). Dos columnas: QUIÉN está (ahora / hace un rato /
//  hoy / sin señal) y QUÉ están haciendo (hechos con plata + navegación, en una
//  sola línea de tiempo). Se actualiza solo cada 20 s mientras la pestaña está a
//  la vista; al volver a la pestaña relee al instante. Tocar una persona filtra
//  el feed a lo suyo. Nada de esto escribe: es una ventana.
// ─────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UYU } from "@/lib/format";
import {
  hace,
  haceSegundos,
  type EnVivo,
  type EstadoPresencia,
  type ItemFeed,
  type PersonaVivo,
} from "@/lib/enVivo/clasificar";

const CADA_MS = 20_000;
const TICK_MS = 5_000;

const ROL: Record<string, { bg: string; fg: string; label: string; corto: string }> = {
  admin: { bg: "var(--color-azul-suave)", fg: "var(--color-azul)", label: "Admin", corto: "A" },
  supervisor: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)", label: "Supervisor", corto: "S" },
  cobrador: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", label: "Cobrador", corto: "C" },
};
const rolDe = (rol: string | null) => ROL[rol ?? ""] ?? ROL.cobrador;

const ESTADO: Record<EstadoPresencia, { titulo: string; punto: string; sub: string }> = {
  ahora: { titulo: "En la app ahora", punto: "#1FA971", sub: "señal en los últimos 10 min" },
  reciente: { titulo: "Hace un rato", punto: "#E8A317", sub: "entre 10 y 60 min" },
  hoy: { titulo: "Entraron hoy", punto: "#9AA3BC", sub: "hace más de una hora" },
  sin_senal: { titulo: "Sin señal hoy", punto: "#DCE3F4", sub: "no abrieron ni cobraron" },
};

const ICONO: Record<string, string> = {
  cobro: "💵",
  deshecho: "↩️",
  credito: "💳",
  censo: "🧍",
  caja: "💰",
  gasto: "⛽",
  correccion: "✏️",
  gestion: "🧾",
  no_pago: "🚫",
  candado: "🔒",
  nav: "·",
};

const horaUY = new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit" });
const hora = (iso: string) => horaUY.format(new Date(iso));

type Clase = "todo" | "hechos" | "nav";

export function EnVivoTablero({ inicial }: { inicial: EnVivo }) {
  const [datos, setDatos] = useState<EnVivo>(inicial);
  const [ahora, setAhora] = useState(() => Date.now());
  const [leidoEn, setLeidoEn] = useState(() => Date.now());
  const [pausado, setPausado] = useState(false);
  const [fallos, setFallos] = useState(0);
  const [persona, setPersona] = useState<string | null>(null);
  const [clase, setClase] = useState<Clase>("todo");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const leyendo = useRef(false);
  const pausadoRef = useRef(pausado);
  useEffect(() => {
    pausadoRef.current = pausado;
  }, [pausado]);

  const refrescar = useCallback(async () => {
    if (leyendo.current) return;
    leyendo.current = true;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch("/api/dev/en-vivo", { cache: "no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as EnVivo;
      if (!j || !Array.isArray(j.personas)) throw new Error("respuesta rara");
      setDatos(j);
      setLeidoEn(Date.now());
      setAhora(Date.now());
      setFallos(0);
    } catch {
      setFallos((f) => f + 1);
    } finally {
      window.clearTimeout(t);
      leyendo.current = false;
    }
  }, []);

  // Reloj de "hace X" + poll cuando la pestaña está a la vista y no está pausado.
  useEffect(() => {
    const tick = window.setInterval(() => setAhora(Date.now()), TICK_MS);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pausadoRef.current) void refrescar();
    }, CADA_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && !pausadoRef.current) void refrescar();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refrescar]);

  const { personas, feed, resumen } = datos;
  const personaSel = persona ? personas.find((p) => p.id === persona) ?? null : null;
  const feedFiltrado = feed.filter(
    (f) =>
      (!persona || f.actorId === persona) &&
      (clase === "todo" || (clase === "hechos" ? f.clase === "hecho" : f.clase === "nav")) &&
      (!soloAlertas || f.alerta),
  );
  const nHechos = feed.filter((f) => f.clase === "hecho" && (!persona || f.actorId === persona)).length;
  const nNav = feed.filter((f) => f.clase === "nav" && (!persona || f.actorId === persona)).length;
  const nAlertas = feed.filter((f) => f.alerta && (!persona || f.actorId === persona)).length;
  const porEstado = (e: EstadoPresencia) => personas.filter((p) => p.estado === e);
  const grupos: EstadoPresencia[] = ["ahora", "reciente", "hoy"];
  const sinSenal = porEstado("sin_senal");
  const desdeLectura = ahora - leidoEn;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
      {/* ── Cabecera + estado de la actualización ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">En vivo</h1>
          <span className="text-[13px] font-medium text-gris">
            Quién está en la app ahora, en qué pantalla, y qué hizo hoy. Lo de otros días vive en{" "}
            <Link href="/admin/uso" className="font-bold text-azul">Adopción</Link>.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-2 rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold tabular-nums"
            style={{ color: fallos > 0 ? "var(--color-rojo-osc)" : pausado ? "var(--color-ambar-osc)" : "var(--color-verde-osc)" }}
            title={`Última lectura ${new Date(leidoEn).toLocaleTimeString("es-UY")}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${!pausado && fallos === 0 ? "animate-pulse" : ""}`}
              style={{ background: fallos > 0 ? "var(--color-rojo-osc)" : pausado ? "var(--color-ambar-osc)" : "#1FA971" }}
            />
            {fallos > 0
              ? `sin respuesta (${fallos} ${fallos === 1 ? "intento" : "intentos"}) · lo último bueno ${haceSegundos(desdeLectura)}`
              : pausado
                ? `pausado · leído ${haceSegundos(desdeLectura)}`
                : `actualizado ${haceSegundos(desdeLectura)} · cada 20 s`}
          </span>
          <button
            type="button"
            onClick={() => setPausado((p) => !p)}
            className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-gris hover:bg-suave"
            aria-label={pausado ? "Reanudar" : "Pausar"}
          >
            {pausado ? "▶ Reanudar" : "⏸ Pausar"}
          </button>
          <button
            type="button"
            onClick={() => void refrescar()}
            className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-gris hover:bg-suave"
          >
            ↻ Ahora
          </button>
        </div>
      </header>

      {/* ── Los cinco números del momento ── */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Kpi label="En la app ahora" valor={String(resumen.ahora)} sub={`de ${resumen.total} con credenciales`} tono="#1FA971" />
        <Kpi label="Entraron hoy" valor={String(resumen.hoy)} sub={resumen.hoy === 0 ? "nadie todavía" : "con alguna señal hoy"} />
        <Kpi
          label="Cobrando hoy"
          valor={String(resumen.cobrando)}
          sub={resumen.cobros > 0 ? `${resumen.cobros} cobros · ${UYU(resumen.cobrado)}` : "sin cobros aún"}
          tono={resumen.cobrando > 0 ? "var(--color-azul)" : undefined}
        />
        <Kpi label="Hechos hoy" valor={String(resumen.hechos)} sub="cobros, ventas, censos, bases…" />
        <Kpi label="Navegaciones" valor={String(resumen.navegaciones)} sub="pantallas abiertas (últimas 150)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ── Columna izquierda: QUIÉN ── */}
        <section className="flex flex-col gap-3">
          {grupos.map((e) => {
            const lst = porEstado(e);
            return (
              <div key={e} className="flex flex-col gap-1.5">
                <h2 className="flex items-center gap-2 px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
                  <span className="h-2 w-2 rounded-full" style={{ background: ESTADO[e].punto }} />
                  {ESTADO[e].titulo} ({lst.length})
                  <span className="font-medium normal-case text-tenue-2">· {ESTADO[e].sub}</span>
                </h2>
                {lst.length === 0 ? (
                  <p className="rounded-[14px] border border-dashed border-borde px-4 py-3 text-[12.5px] font-medium text-tenue">
                    {e === "ahora" ? "Nadie con señal en los últimos 10 minutos." : "Nadie."}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
                    {lst.map((p) => (
                      <FilaPersona
                        key={p.id}
                        p={p}
                        ahora={ahora}
                        destacada={e === "ahora"}
                        seleccionada={persona === p.id}
                        onClick={() => setPersona((cur) => (cur === p.id ? null : p.id))}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {sinSenal.length > 0 && (
            <details className="group rounded-[16px] border border-borde bg-tarjeta">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[12px] font-bold tracking-[0.03em] text-gris uppercase select-none">
                <span className="h-2 w-2 rounded-full" style={{ background: ESTADO.sin_senal.punto }} />
                Sin señal hoy ({sinSenal.length})
                <span className="ml-auto text-[11px] font-medium normal-case text-tenue-2 group-open:hidden">ver</span>
              </summary>
              <ul className="flex flex-col divide-y divide-linea border-t border-linea">
                {sinSenal.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[12.5px]">
                    <Chip rol={p.rol} />
                    <span className="min-w-0 truncate font-semibold text-gris">{p.nombre}</span>
                    {p.zona && <span className="text-[11px] text-tenue-2">{p.zona.replace("Zona ", "")}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* ── Columna derecha: QUÉ ── */}
        <section className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <h2 className="mr-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Qué están haciendo</h2>
            <ChipFiltro activo={clase === "todo"} onClick={() => setClase("todo")}>
              Todo ({nHechos + nNav})
            </ChipFiltro>
            <ChipFiltro activo={clase === "hechos"} onClick={() => setClase("hechos")}>
              Hechos ({nHechos})
            </ChipFiltro>
            <ChipFiltro activo={clase === "nav"} onClick={() => setClase("nav")}>
              Navegación ({nNav})
            </ChipFiltro>
            <ChipFiltro activo={soloAlertas} onClick={() => setSoloAlertas((v) => !v)} tono="rojo">
              ⚠ Alertas ({nAlertas})
            </ChipFiltro>
            {personaSel && (
              <button
                type="button"
                onClick={() => setPersona(null)}
                className="ml-auto flex items-center gap-1.5 rounded-full bg-azul px-3 py-1 text-[12px] font-bold text-white"
              >
                Solo {personaSel.nombre} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          {feedFiltrado.length === 0 ? (
            <p className="rounded-[16px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
              {feed.length === 0 ? "Todavía nada hoy. Apenas alguien abra la app o cobre, aparece acá." : "Nada con este filtro."}
            </p>
          ) : (
            <ol className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
              {feedFiltrado.slice(0, 250).map((f) => (
                <FilaFeed key={f.id} f={f} onPersona={() => setPersona(f.actorId)} />
              ))}
            </ol>
          )}
          {feedFiltrado.length > 250 && (
            <p className="px-1 text-[11.5px] font-medium text-tenue-2">y {feedFiltrado.length - 250} más hoy.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function FilaPersona({
  p,
  ahora,
  destacada,
  seleccionada,
  onClick,
}: {
  p: PersonaVivo;
  ahora: number;
  destacada: boolean;
  seleccionada: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full flex-col gap-1 px-3.5 text-left transition-colors hover:bg-suave ${destacada ? "py-3" : "py-2"} ${seleccionada ? "bg-azul-suave" : ""}`}
        title={p.pathActual ?? undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Chip rol={p.rol} />
          <span className={`min-w-0 truncate font-extrabold text-tinta ${destacada ? "text-[14px]" : "text-[13px]"}`}>{p.nombre}</span>
          {p.zona && <span className="flex-shrink-0 text-[11px] font-semibold text-tenue">{p.zona.replace("Zona ", "")}</span>}
          {p.cobrosHoy > 0 && (
            <span className="flex-shrink-0 rounded-full bg-verde-suave px-2 py-0.5 text-[10.5px] font-bold text-verde-osc tabular-nums">
              💵 {p.cobrosHoy} · {UYU(p.cobradoHoy)}
            </span>
          )}
          <span className="ml-auto flex-shrink-0 text-[11px] font-semibold text-tenue tabular-nums">{hace(p.ultimaSenalIso, ahora)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-medium text-gris">
          {p.seccionActual ? (
            <span className="min-w-0 truncate">
              <span className="text-tenue-2">en</span> <b className="text-tinta">{p.seccionActual.replace(" (cobrador)", "")}</b>
            </span>
          ) : (
            <span className="text-tenue-2">sin navegación registrada</span>
          )}
          {p.ultimoHecho && (
            <span className="min-w-0 truncate">
              <span className="text-tenue-2">·</span> {p.ultimoHecho.titulo}
              {p.ultimoHecho.monto != null && <b className="text-tinta"> {UYU(p.ultimoHecho.monto)}</b>}
            </span>
          )}
          <span className="ml-auto flex-shrink-0 text-tenue-2 tabular-nums">
            {p.hechosHoy} {p.hechosHoy === 1 ? "hecho" : "hechos"} · {p.vistasHoy} vistas
          </span>
        </div>
      </button>
    </li>
  );
}

function FilaFeed({ f, onPersona }: { f: ItemFeed; onPersona: () => void }) {
  const nav = f.clase === "nav";
  return (
    <li
      className={`flex items-center gap-2.5 px-3.5 ${nav ? "py-1.5" : "py-2.5"}`}
      style={f.alerta ? { background: "var(--color-rojo-suave)" } : undefined}
      title={f.detalle ?? undefined}
    >
      <span className="w-11 flex-shrink-0 text-[11px] font-medium text-tenue tabular-nums">{hora(f.cuando)}</span>
      <span aria-hidden="true" className={`w-5 flex-shrink-0 text-center ${nav ? "text-tenue-2" : "text-[14px]"}`}>
        {ICONO[f.tipo] ?? "•"}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <button
          type="button"
          onClick={onPersona}
          className={`font-extrabold hover:underline ${nav ? "text-[12px] text-gris" : "text-[13px] text-tinta"}`}
        >
          {f.actor}
        </button>
        <span className={`${nav ? "text-[12px] text-tenue" : "text-[13px] text-cuerpo"}`}> {f.titulo}</span>
        {!nav && f.detalle && <span className="text-[11.5px] text-tenue-2"> · {f.detalle}</span>}
      </span>
      {f.monto != null && (
        <span
          className="flex-shrink-0 text-[13px] font-extrabold tabular-nums"
          style={{ color: f.alerta ? "var(--color-rojo-osc)" : f.tipo === "cobro" ? "var(--color-verde-osc)" : "var(--color-tinta)" }}
        >
          {UYU(f.monto)}
        </span>
      )}
      <Chip rol={f.rol} corto />
    </li>
  );
}

function Chip({ rol, corto }: { rol: string | null; corto?: boolean }) {
  const t = rolDe(rol);
  return (
    <span
      className={`flex-shrink-0 rounded-full font-bold ${corto ? "h-5 w-5 text-center text-[10px] leading-5" : "px-2 py-0.5 text-[10.5px]"}`}
      style={{ background: t.bg, color: t.fg }}
      title={t.label}
    >
      {corto ? t.corto : t.label}
    </span>
  );
}

function ChipFiltro({
  activo,
  onClick,
  children,
  tono,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tono?: "rojo";
}) {
  const on = tono === "rojo" ? { border: "1px solid var(--color-rojo-osc)", background: "var(--color-rojo-suave)", color: "var(--color-rojo-osc)" } : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12px] font-bold ${activo && !tono ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris hover:text-tinta"}`}
      style={activo && tono ? on : undefined}
    >
      {children}
    </button>
  );
}

function Kpi({ label, valor, sub, tono }: { label: string; valor: string; sub?: string; tono?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[20px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{valor}</span>
      {sub && <span className="truncate text-[10.5px] font-medium text-tenue-2">{sub}</span>}
    </div>
  );
}

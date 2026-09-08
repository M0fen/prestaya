"use client";
// ─────────────────────────────────────────────────────────────────────────
//  PENDIENTES DEL PILOTO — la agenda editable (0157). Cada renglón: prioridad,
//  título, dueño, plata, desde cuándo; se despliega para ver el detalle, el
//  historial y mover de estado con nota. Cerrar (resuelto/aceptado) exige nota:
//  es lo que se decidió, y queda escrito.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import type { CategoriaPendiente, DuenoPendiente, EstadoPendiente, Pendiente, PrioridadPendiente } from "@/lib/data/pilotoPendientes";
import { crearPendienteAction, moverPendienteAction } from "@/app/admin/(panel)/piloto/actions";

const PRIO: Record<PrioridadPendiente, { punto: string; label: string }> = {
  alta: { punto: "var(--color-rojo-osc)", label: "alta" },
  media: { punto: "var(--color-ambar-osc)", label: "media" },
  baja: { punto: "var(--color-tenue-2)", label: "baja" },
};
const ESTADO: Record<EstadoPendiente, { bg: string; fg: string; label: string }> = {
  abierto: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)", label: "abierto" },
  en_progreso: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", label: "en progreso" },
  resuelto: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)", label: "resuelto" },
  aceptado: { bg: "var(--color-suave)", fg: "var(--color-gris)", label: "aceptado" },
};
const DUENO: Record<DuenoPendiente, string> = { carlos: "Carlos", mauricio: "Mauricio", carolina: "Carolina", equipo: "equipo" };
const CAT: Record<CategoriaPendiente, string> = { plata: "💵 plata", datos: "🗂️ datos", adopcion: "📱 adopción", tecnico: "🛠️ técnico", negocio: "🤝 negocio" };

const diasDesde = (ymd: string, hoy: string): number => {
  const a = Date.parse(`${ymd}T12:00:00Z`);
  const b = Date.parse(`${hoy}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
};
const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

type Vista = "abiertos" | "cerrados" | "todos";

export function PilotoPendientes({ pendientes, hoy }: { pendientes: Pendiente[]; hoy: string }) {
  const [vista, setVista] = useState<Vista>("abiertos");
  const [dueno, setDueno] = useState<DuenoPendiente | "todos">("todos");
  const [nuevo, setNuevo] = useState(false);
  const abiertos = pendientes.filter((p) => p.estado === "abierto" || p.estado === "en_progreso");
  const lista = pendientes.filter(
    (p) =>
      (vista === "todos" || (vista === "abiertos" ? p.estado === "abierto" || p.estado === "en_progreso" : p.estado === "resuelto" || p.estado === "aceptado")) &&
      (dueno === "todos" || p.dueno === dueno),
  );
  const plataAbierta = abiertos.reduce((s, p) => s + (p.monto ?? 0), 0);

  return (
    <section id="pendientes" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div className="flex flex-col">
          <h2 className="text-[16px] font-extrabold text-tinta">Pendientes y decisiones</h2>
          <span className="text-[12px] font-medium text-gris">
            {abiertos.length} abiertos · {UYU(plataAbierta)} en juego · {pendientes.length - abiertos.length} cerrados con nota
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["abiertos", "cerrados", "todos"] as Vista[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`rounded-full border px-3 py-1 text-[12px] font-bold ${vista === v ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}
            >
              {v}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-borde" aria-hidden="true" />
          {(["todos", "carlos", "mauricio", "carolina", "equipo"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDueno(d)}
              className={`rounded-full border px-3 py-1 text-[12px] font-bold ${dueno === d ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}
            >
              {d === "todos" ? "todos" : DUENO[d]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNuevo((v) => !v)}
            className="ml-1 rounded-full bg-azul px-3.5 py-1 text-[12px] font-bold text-white"
          >
            {nuevo ? "Cerrar" : "+ Nuevo"}
          </button>
        </div>
      </div>

      {nuevo && <FormNuevo onListo={() => setNuevo(false)} />}

      {lista.length === 0 ? (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-5 text-center text-[13px] font-medium text-gris">Nada con este filtro.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
          {lista.map((p) => (
            <FilaPendiente key={p.id} p={p} hoy={hoy} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaPendiente({ p, hoy }: { p: Pendiente; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const cerrado = p.estado === "resuelto" || p.estado === "aceptado";
  const dias = diasDesde(p.desde, hoy);

  const mover = (estado: EstadoPendiente) => {
    setError(null);
    startTransition(async () => {
      const r = await moverPendienteAction(p.id, estado, nota);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNota("");
      router.refresh();
    });
  };

  return (
    <li className={cerrado ? "opacity-70" : ""}>
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full flex-col gap-1 px-3.5 py-3 text-left hover:bg-suave">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: PRIO[p.prioridad].punto }} title={`prioridad ${PRIO[p.prioridad].label}`} />
          <span className={`min-w-0 flex-1 text-[13.5px] font-extrabold text-tinta ${cerrado ? "line-through decoration-tenue-2" : ""}`}>{p.titulo}</span>
          {p.monto != null && p.monto > 0 && <span className="flex-shrink-0 text-[13px] font-extrabold text-tinta tabular-nums">{UYU(p.monto)}</span>}
          <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: ESTADO[p.estado].bg, color: ESTADO[p.estado].fg }}>
            {ESTADO[p.estado].label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-[18px] text-[11.5px] font-medium text-gris">
          <span>
            👤 <b className="text-tinta">{DUENO[p.dueno]}</b>
          </span>
          <span>{CAT[p.categoria]}</span>
          <span className="tabular-nums">
            desde {p.desde.slice(8, 10)}/{p.desde.slice(5, 7)} · {dias === 0 ? "hoy" : `${dias} d`}
          </span>
          {p.origen && <span className="text-tenue-2">· {p.origen}</span>}
          <span className="ml-auto text-tenue-2">{abierto ? "▲" : "▼"}</span>
        </div>
      </button>
      {abierto && (
        <div className="flex flex-col gap-3 border-t border-linea bg-suave px-3.5 py-3">
          {p.detalle && <p className="text-[12.5px] leading-[1.55] font-medium whitespace-pre-line text-cuerpo">{p.detalle}</p>}
          {p.historial.length > 0 && (
            <ul className="flex flex-col gap-1 text-[11.5px] font-medium text-gris">
              {p.historial
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="tabular-nums">
                    {fechaCorta(h.en)} · <b className="text-tinta">{h.por}</b>: {h.de ? `${ESTADO[h.de].label} → ` : ""}
                    {ESTADO[h.a].label}
                    {h.nota && <span className="text-cuerpo"> — {h.nota}</span>}
                  </li>
                ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder={cerrado ? "Nota para reabrir (opcional)" : "Qué se decidió / qué se hizo (obligatorio para cerrar)"}
              className="w-full rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[12.5px] font-medium text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {p.estado !== "en_progreso" && !cerrado && (
                <Boton onClick={() => mover("en_progreso")} disabled={pendiente} tono="ambar">
                  ⏳ En progreso
                </Boton>
              )}
              {!cerrado && (
                <>
                  <Boton onClick={() => mover("resuelto")} disabled={pendiente} tono="verde">
                    ✓ Resuelto
                  </Boton>
                  <Boton onClick={() => mover("aceptado")} disabled={pendiente} tono="gris">
                    Aceptado (se queda así)
                  </Boton>
                </>
              )}
              {cerrado && (
                <Boton onClick={() => mover("abierto")} disabled={pendiente} tono="rojo">
                  ↺ Reabrir
                </Boton>
              )}
              {pendiente && <span className="text-[11.5px] font-medium text-tenue">guardando…</span>}
              {error && <span className="text-[11.5px] font-bold text-rojo-osc">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function FormNuevo({ onListo }: { onListo: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2 rounded-[16px] border border-azul bg-tarjeta p-4 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const r = await crearPendienteAction(fd);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          onListo();
          router.refresh();
        });
      }}
    >
      <input name="titulo" required placeholder="Título (qué hay que decidir o arreglar)" className="md:col-span-6 rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[13px] font-semibold text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none" />
      <textarea name="detalle" rows={2} placeholder="Detalle: cifras, nombres, dónde está la evidencia" className="md:col-span-6 rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[12.5px] font-medium text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none" />
      <Select name="dueno" opciones={[["carlos", "Carlos"], ["mauricio", "Mauricio"], ["carolina", "Carolina"], ["equipo", "equipo"]]} />
      <Select name="categoria" opciones={[["plata", "plata"], ["datos", "datos"], ["adopcion", "adopción"], ["tecnico", "técnico"], ["negocio", "negocio"]]} />
      <Select name="prioridad" opciones={[["media", "media"], ["alta", "alta"], ["baja", "baja"]]} />
      <input name="monto" inputMode="numeric" placeholder="$ en juego" className="rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[12.5px] font-medium text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none" />
      <input name="origen" placeholder="Origen (sesión, informe…)" className="rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[12.5px] font-medium text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none" />
      <button type="submit" disabled={pendiente} className="rounded-[10px] bg-azul px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
        {pendiente ? "Guardando…" : "Guardar"}
      </button>
      {error && <span className="md:col-span-6 text-[12px] font-bold text-rojo-osc">{error}</span>}
    </form>
  );
}

function Select({ name, opciones }: { name: string; opciones: [string, string][] }) {
  return (
    <select name={name} className="rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[12.5px] font-semibold text-tinta focus:border-azul focus:outline-none">
      {opciones.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Boton({ onClick, disabled, tono, children }: { onClick: () => void; disabled?: boolean; tono: "verde" | "ambar" | "gris" | "rojo"; children: React.ReactNode }) {
  const estilo = {
    verde: { background: "var(--color-verde-suave)", color: "var(--color-verde-osc)" },
    ambar: { background: "var(--color-ambar-suave)", color: "var(--color-ambar-osc)" },
    gris: { background: "var(--color-suave)", color: "var(--color-gris)", border: "1px solid var(--color-borde)" },
    rojo: { background: "var(--color-rojo-suave)", color: "var(--color-rojo-osc)" },
  }[tono];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-full px-3 py-1.5 text-[12px] font-bold disabled:opacity-60" style={estilo}>
      {children}
    </button>
  );
}

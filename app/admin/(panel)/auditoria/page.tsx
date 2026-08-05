// Auditoría (SOLO admin): la bitácora VIVA de la operación. Antes mostraba solo
// la tabla `auditoria` (metadatos de configuración) y el dueño no veía lo que de
// verdad pasa: cobros, deshechos, bases, gastos, correcciones, colocaciones y
// censos. Ahora todo eso se funde en una sola línea de tiempo (lib/data/actividad)
// con filtros por período, tipo y persona — navegables por URL, sin JS extra.
// Admin-only a propósito: incluye plata de todas las zonas.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getActividad, getResumenHoy, type EventoActividad, type TipoActividad } from "@/lib/data/actividad";
import { inicioDiaUYIso, fechaISOUY, diaUYInicioIso, sumarDiasYmd } from "@/lib/fecha";
import { UYU, horaDe, diasSemana, meses, parseFecha } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGOS = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
] as const;
type Rango = (typeof RANGOS)[number]["id"];

const CATEGORIAS = [
  { id: "todo", label: "Todo", tipos: null },
  { id: "plata", label: "💵 Cobros", tipos: ["cobro", "deshecho", "correccion"] },
  { id: "cajas", label: "📦 Cajas y gastos", tipos: ["caja", "gasto"] },
  { id: "cartera", label: "🤝 Créditos y censos", tipos: ["credito", "censo"] },
  { id: "gestion", label: "⚙️ Gestión", tipos: ["gestion"] },
] as const;
type Categoria = (typeof CATEGORIAS)[number]["id"];

const ICONO: Record<TipoActividad, string> = {
  cobro: "💵",
  deshecho: "↩️",
  correccion: "🛡️",
  caja: "📦",
  gasto: "🧾",
  credito: "🤝",
  censo: "🧍",
  gestion: "⚙️",
};

/** Rango elegido → [desde, hasta) en ISO (día de Uruguay). */
function limites(rango: Rango): { desde: string; hasta?: string } {
  const hoyYmd = fechaISOUY();
  if (rango === "hoy") return { desde: inicioDiaUYIso() };
  if (rango === "ayer")
    return { desde: diaUYInicioIso(sumarDiasYmd(hoyYmd, -1)), hasta: inicioDiaUYIso() };
  if (rango === "7d") return { desde: diaUYInicioIso(sumarDiasYmd(hoyYmd, -6)) };
  return { desde: diaUYInicioIso(sumarDiasYmd(hoyYmd, -29)) };
}

function etiquetaDia(ymd: string): string {
  const hoyYmd = fechaISOUY();
  const d = parseFecha(ymd);
  const nombre = `${diasSemana[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
  if (ymd === hoyYmd) return `Hoy · ${nombre}`;
  if (ymd === sumarDiasYmd(hoyYmd, -1)) return `Ayer · ${nombre}`;
  return nombre;
}

/** Primer nombre (o apodo corto) para el chip de persona. */
const nombreCorto = (n: string): string => n.split(/\s+/).slice(0, 2).join(" ");

export default async function AuditoriaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;
  const uno = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

  const rango = (RANGOS.some((r) => r.id === uno(sp.rango)) ? uno(sp.rango) : "hoy") as Rango;
  const cat = (CATEGORIAS.some((c) => c.id === uno(sp.tipo)) ? uno(sp.tipo) : "todo") as Categoria;
  const quien = uno(sp.quien) || null;
  const n = Math.min(600, Math.max(60, Number(uno(sp.n)) || 60));

  const db = await createSupabaseServer();
  const { desde, hasta } = limites(rango);
  const [todos, resumen] = await Promise.all([getActividad(db, desde, hasta), getResumenHoy(db)]);

  // Personas con actividad en el rango (para los chips), ordenadas por cuánto hicieron.
  const porActor = new Map<string, { nombre: string; veces: number }>();
  for (const e of todos) {
    if (!e.actorId) continue;
    const p = porActor.get(e.actorId);
    if (p) p.veces++;
    else porActor.set(e.actorId, { nombre: e.actor, veces: 1 });
  }
  const personas = [...porActor.entries()]
    .sort((a, b) => b[1].veces - a[1].veces)
    .slice(0, 14);

  const tiposCat = CATEGORIAS.find((c) => c.id === cat)?.tipos ?? null;
  const filtrados = todos.filter(
    (e) => (!tiposCat || (tiposCat as readonly string[]).includes(e.tipo)) && (!quien || e.actorId === quien),
  );
  const visibles = filtrados.slice(0, n);
  const hayMas = filtrados.length > n;

  // Agrupar por día (de Uruguay) preservando el orden nuevo→viejo.
  const dias: { ymd: string; eventos: EventoActividad[] }[] = [];
  for (const e of visibles) {
    const ymd = fechaISOUY(new Date(e.cuando));
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.ymd === ymd) ultimo.eventos.push(e);
    else dias.push({ ymd, eventos: [e] });
  }

  /** Link que cambia UN parámetro conservando el resto (y limpia n al re-filtrar). */
  const link = (cambios: Partial<Record<"rango" | "tipo" | "quien", string | null>>): string => {
    const p = new URLSearchParams();
    const rangoF = cambios.rango === undefined ? rango : cambios.rango;
    const tipoF = cambios.tipo === undefined ? cat : cambios.tipo;
    const quienF = cambios.quien === undefined ? quien : cambios.quien;
    if (rangoF && rangoF !== "hoy") p.set("rango", rangoF);
    if (tipoF && tipoF !== "todo") p.set("tipo", tipoF);
    if (quienF) p.set("quien", quienF);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const chip = (activo: boolean): string =>
    activo
      ? "rounded-full bg-azul px-3 py-1.5 text-[12.5px] font-bold text-white"
      : "rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12.5px] font-bold text-gris hover:text-tinta";

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Auditoría</h1>
        <span className="text-[13px] font-medium text-gris">
          Todo el movimiento del equipo: quién hizo qué, cuándo y por cuánto.
        </span>
      </div>

      {/* ── Los números de HOY, siempre visibles ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 flex flex-col rounded-[14px] border border-borde bg-tarjeta px-3.5 py-3">
          <span className="text-[11px] font-bold tracking-wide text-tenue uppercase">Cobros de hoy</span>
          <span className="text-[22px] font-extrabold tracking-[-0.02em] text-tinta tabular-nums">
            {UYU(resumen.cobrado)}
          </span>
          <span className="text-[11.5px] font-medium text-gris tabular-nums">{resumen.cobros} cobros registrados</span>
        </div>
        <div
          className={`flex flex-col rounded-[14px] border px-3.5 py-3 ${
            resumen.pendientes > 0 ? "border-[#F2DCB3] bg-[#FFF7E8]" : "border-borde bg-tarjeta"
          }`}
        >
          <span className="text-[11px] font-bold tracking-wide text-tenue uppercase">Esperan aval</span>
          <span className={`text-[22px] font-extrabold tabular-nums ${resumen.pendientes > 0 ? "text-[#B07908]" : "text-tinta"}`}>
            {resumen.pendientes}
          </span>
          <span className="text-[11.5px] font-medium text-gris">correcciones y gastos</span>
        </div>
        {[
          { k: "Deshechos", v: resumen.deshechos, alerta: resumen.deshechos > 0 },
          { k: "Bases cargadas", v: resumen.bases, alerta: false },
          { k: "Créditos", v: resumen.creditos, alerta: false },
        ].map((t) => (
          <div key={t.k} className="flex flex-col rounded-[14px] border border-borde bg-tarjeta px-3.5 py-2.5">
            <span className="text-[10.5px] font-bold tracking-wide text-tenue uppercase">{t.k}</span>
            <span className={`text-[18px] font-extrabold tabular-nums ${t.alerta ? "text-[#B07908]" : "text-tinta"}`}>
              {t.v}
            </span>
          </div>
        ))}
      </div>

      {/* ── Filtros: período · tipo · persona ── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {RANGOS.map((r) => (
            <a key={r.id} href={link({ rango: r.id })} className={chip(rango === r.id)}>
              {r.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIAS.map((c) => (
            <a key={c.id} href={link({ tipo: c.id })} className={chip(cat === c.id)}>
              {c.label}
            </a>
          ))}
        </div>
        {personas.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <a href={link({ quien: null })} className={`${chip(!quien)} whitespace-nowrap`}>
              Todos
            </a>
            {personas.map(([id, p]) => (
              <a key={id} href={link({ quien: id })} className={`${chip(quien === id)} whitespace-nowrap`}>
                {nombreCorto(p.nombre)} · {p.veces}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Línea de tiempo ── */}
      {visibles.length === 0 ? (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-10 text-center text-[13px] font-medium text-gris">
          Sin movimientos con este filtro.
          <br />
          <span className="text-[12px] text-tenue-2">Probá con otro período o con «Todo».</span>
        </p>
      ) : (
        dias.map((dia) => (
          <section key={dia.ymd} className="flex flex-col gap-1.5">
            <h2 className="px-1 text-[12px] font-extrabold tracking-wide text-tenue uppercase">
              {etiquetaDia(dia.ymd)}
              <span className="ml-1.5 font-bold text-tenue-2 normal-case">· {dia.eventos.length}</span>
            </h2>
            <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
              {dia.eventos.map((e) => (
                <li key={e.id} className={`flex items-center gap-3 px-3.5 py-3 ${e.alerta ? "bg-[#FFFBF2]" : ""}`}>
                  <span className="text-[17px]" aria-hidden="true">
                    {ICONO[e.tipo]}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] text-tinta">
                      <b className="font-extrabold">{e.actor}</b>{" "}
                      <span className="font-medium">{e.titulo.charAt(0).toLowerCase() + e.titulo.slice(1)}</span>
                    </span>
                    {e.detalle && (
                      <span className="truncate text-[11.5px] font-medium text-tenue">{e.detalle}</span>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end">
                    {e.monto != null && (
                      <span
                        className={`text-[13.5px] font-extrabold tabular-nums ${e.alerta ? "text-[#B07908]" : "text-tinta"}`}
                      >
                        {UYU(e.monto)}
                      </span>
                    )}
                    <span className="text-[11px] font-semibold text-tenue-2 tabular-nums">{horaDe(e.cuando)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {hayMas && (
        <a
          href={`${link({})}${link({}) === "?" ? "" : "&"}n=${n + 150}`}
          className="rounded-[14px] border border-borde bg-tarjeta px-4 py-3 text-center text-[13.5px] font-bold text-azul hover:bg-suave"
        >
          Mostrar más movimientos
        </a>
      )}
    </div>
  );
}

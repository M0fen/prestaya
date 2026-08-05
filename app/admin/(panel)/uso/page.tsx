// Auditoría de comportamiento del personal (DEV-gated). Control total: quién usa
// la app y quién no, bajo qué perfil, a QUÉ sección fue y por dónde navegó.
// Rediseño 08-05 (pedido de Carlos): grupos claros (usando / sin entrar) en vez de
// ranking que ponía el ruido primero, filas compactas, filtro por ZONA y búsqueda,
// y las dos señales que importan en la adopción: 🔑 clave propia y 💵 cobros de hoy.
import Link from "next/link";
import { requireDev } from "@/lib/auth";
import {
  getAuditoriaComportamiento,
  getActividadReciente,
  getEventosDePersona,
  type UsoPersona,
} from "@/lib/data/uso";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROL_TONO: Record<string, { bg: string; fg: string; label: string }> = {
  admin: { bg: "#EEF3FF", fg: "#1E47C8", label: "Admin" },
  supervisor: { bg: "#EAF7F1", fg: "#157A50", label: "Supervisor" },
  cobrador: { bg: "#FDF3E2", fg: "#9A6A0E", label: "Cobrador" },
};

function hace(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return `hace ${Math.floor(d / 30)} mes`;
}
const horaUY = (iso: string) =>
  new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Momento más reciente en que la persona dio señales de vida (vista o login). */
const ultimaSenal = (p: UsoPersona): string | null =>
  !p.ultimaVistaIso ? p.ultimoAccesoIso : !p.ultimoAccesoIso ? p.ultimaVistaIso : p.ultimaVistaIso > p.ultimoAccesoIso ? p.ultimaVistaIso : p.ultimoAccesoIso;

function ChipClave({ p }: { p: UsoPersona }) {
  return p.claveCambiadaIso ? (
    <span className="flex-shrink-0 rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[10.5px] font-bold text-[#157A50]">🔑 clave propia</span>
  ) : (
    <span className="flex-shrink-0 rounded-full bg-[#FDF3E2] px-2 py-0.5 text-[10.5px] font-bold text-[#9A6A0E]">🔑 de arranque</span>
  );
}

export default async function UsoPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; rol?: string; u?: string; z?: string; q?: string }>;
}) {
  await requireDev();
  const sp = await searchParams;
  const dias = sp.dias === "7" ? 7 : sp.dias === "90" ? 90 : 30;
  const desdeIso = new Date(Date.now() - dias * 86400000).toISOString();
  const rolF = sp.rol === "cobrador" || sp.rol === "supervisor" || sp.rol === "admin" ? sp.rol : undefined;
  const zonaF = (sp.z ?? "").trim() || undefined; // nombre de zona, o "—" = sin zona
  const q = (sp.q ?? "").trim();
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    p.set("dias", String(dias));
    if (rolF) p.set("rol", rolF);
    if (zonaF) p.set("z", zonaF);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra)) v === undefined ? p.delete(k) : p.set(k, v);
    return `/admin/uso?${p.toString()}`;
  };

  const personas = await getAuditoriaComportamiento(desdeIso);

  // ── DRILL-DOWN: historial completo de una persona ──────────────────────
  if (sp.u) {
    const persona = personas.find((p) => p.id === sp.u);
    const eventos = await getEventosDePersona(sp.u, desdeIso);
    const t = persona ? ROL_TONO[persona.rol] ?? ROL_TONO.cobrador : ROL_TONO.cobrador;
    return (
      <div className="mx-auto flex max-w-[820px] flex-col gap-4">
        <Link href={qs({ u: undefined })} className="text-[13px] font-semibold text-azul">
          ← Volver a la auditoría
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-tinta">{persona?.nombre ?? "Persona"}</h1>
          {persona?.zona && <span className="text-[12.5px] font-semibold text-tenue">{persona.zona}</span>}
          {persona && <ChipClave p={persona} />}
          {persona && persona.cobrosHoy > 0 && (
            <span className="rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[10.5px] font-bold text-[#157A50] tabular-nums">
              💵 hoy {persona.cobrosHoy} · {UYU(persona.cobradoHoy)}
            </span>
          )}
        </div>
        {persona && (
          <p className="text-[13px] font-medium text-gris">
            Último acceso {hace(persona.ultimoAccesoIso)} · {persona.vistas} vistas · {persona.diasActivos} días activos ·{" "}
            {persona.acciones} acciones{persona.faltan.length > 0 ? ` · no abrió: ${persona.faltan.join(", ")}` : ""}
          </p>
        )}
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
          <h2 className="mb-3 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Historial de navegación ({eventos.length}) · últimos {dias} días
          </h2>
          {eventos.length === 0 ? (
            <p className="text-[13px] font-medium text-gris">Sin navegaciones registradas en la ventana.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-linea">
              {eventos.map((e, i) => (
                <li key={i} className="flex items-center gap-3 py-2">
                  <span className="w-24 flex-shrink-0 text-[11.5px] font-medium text-tenue tabular-nums">{horaUY(e.creadoEn)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-tinta">{e.seccion}</span>
                  <span className="hidden flex-shrink-0 truncate font-mono text-[11px] text-tenue-2 sm:block">{e.path}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── OVERVIEW ───────────────────────────────────────────────────────────
  const zonas = [...new Set(personas.map((p) => p.zona).filter((z): z is string => !!z))].sort();
  const filtradas = personas.filter(
    (p) =>
      (!rolF || p.rol === rolF) &&
      (!zonaF || (zonaF === "—" ? !p.zona : p.zona === zonaF)) &&
      (!q || norm(p.nombre).includes(norm(q))),
  );
  const activos = filtradas
    .filter((p) => p.vistas > 0)
    .sort((a, b) => ((ultimaSenal(b) ?? "") < (ultimaSenal(a) ?? "") ? -1 : 1));
  const entraronSinNavegar = filtradas.filter((p) => p.vistas === 0 && p.ultimoAccesoIso);
  const nuncaEntraron = filtradas.filter((p) => p.vistas === 0 && !p.ultimoAccesoIso);

  const reciente = await getActividadReciente(120, rolF);
  const conClave = filtradas.filter((p) => p.claveCambiadaIso).length;
  const cobrando = filtradas.filter((p) => p.cobrosHoy > 0).length;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Auditoría de uso del personal</h1>
            <span className="text-[13px] font-medium text-gris">
              Quién usa la app y quién no, bajo qué perfil, a qué sección fue y por dónde navegó.
            </span>
          </div>
          <div className="flex rounded-full bg-suave p-0.5">
            {([["7", "7 días"], ["30", "30 días"], ["90", "90 días"]] as const).map(([id, label]) => (
              <Link key={id} href={qs({ dias: id })} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${String(dias) === id ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"}`}>{label}</Link>
            ))}
          </div>
        </div>
        {/* Filtros: perfil · zona · búsqueda */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([[undefined, "Todos"], ["cobrador", "Cobradores"], ["supervisor", "Supervisores"], ["admin", "Admin"]] as const).map(([id, label]) => (
            <Link key={label} href={qs({ rol: id })} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${rolF === id ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}>{label}</Link>
          ))}
          <span className="mx-1 h-4 w-px bg-borde" aria-hidden="true" />
          <Link href={qs({ z: undefined })} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${!zonaF ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}>Todas las zonas</Link>
          {zonas.map((z) => (
            <Link key={z} href={qs({ z })} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${zonaF === z ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}>{z.replace("Zona ", "")}</Link>
          ))}
          <Link href={qs({ z: "—" })} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${zonaF === "—" ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}>Sin zona</Link>
          <form action="/admin/uso" method="get" className="ml-auto flex items-center gap-1.5">
            <input type="hidden" name="dias" value={String(dias)} />
            {rolF && <input type="hidden" name="rol" value={rolF} />}
            {zonaF && <input type="hidden" name="z" value={zonaF} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre…"
              className="w-44 rounded-full border border-borde bg-tarjeta px-3.5 py-1.5 text-[12.5px] font-semibold text-tinta placeholder:text-tenue-2 focus:border-azul focus:outline-none"
            />
          </form>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Kpi label="Con credenciales" valor={String(filtradas.length)} />
        <Kpi label="Usando la app" valor={String(activos.length)} tono="#157A50" />
        <Kpi label="🔑 Clave propia" valor={`${conClave}/${filtradas.length}`} tono={conClave === filtradas.length ? "#157A50" : "#9A6A0E"} />
        <Kpi label="💵 Cobrando hoy" valor={String(cobrando)} tono="#1E47C8" />
        <Kpi label="Sin entrar" valor={String(nuncaEntraron.length)} tono={nuncaEntraron.length > 0 ? "#C0392B" : "#157A50"} />
      </div>

      {/* Nota: la telemetría es hacia adelante desde 0064. */}
      <p className="rounded-[12px] border border-borde bg-azul-suave px-4 py-2.5 text-[12px] font-medium text-cuerpo">
        📡 Cada perfil aparece con datos <b>a medida que entra y navega</b>. «🔑 de arranque» = todavía no puso su
        contraseña propia (la tarjeta del día 1 se lo pide al entrar).
      </p>

      {/* ── Usando la app ── */}
      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          🟢 Usando la app ({activos.length}) · lo más reciente primero
        </h2>
        {activos.length === 0 ? (
          <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
            Nadie navegó todavía con este filtro.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {activos.map((p) => {
              const t = ROL_TONO[p.rol] ?? ROL_TONO.cobrador;
              return (
                <li key={p.id}>
                  <Link href={qs({ u: p.id })} className="flex flex-col gap-1.5 px-3.5 py-3 transition-colors hover:bg-suave">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                      <span className="min-w-0 truncate text-[14px] font-extrabold text-tinta">{p.nombre}</span>
                      {p.zona && <span className="flex-shrink-0 text-[11.5px] font-semibold text-tenue">{p.zona.replace("Zona ", "")}</span>}
                      <ChipClave p={p} />
                      {p.cobrosHoy > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-[#E4F5EC] px-2 py-0.5 text-[10.5px] font-bold text-[#157A50] tabular-nums">
                          💵 hoy {p.cobrosHoy} · {UYU(p.cobradoHoy)}
                        </span>
                      )}
                      <span className="ml-auto flex-shrink-0 text-[11.5px] font-semibold text-tenue tabular-nums">
                        {hace(ultimaSenal(p))}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-medium text-gris tabular-nums">
                      <span>{p.vistas} vistas</span>
                      <span>{p.diasActivos} días activos</span>
                      <span>{p.acciones} acciones</span>
                      {p.secciones.slice(0, 4).map((s) => (
                        <span key={s.seccion} className="rounded-full bg-suave px-2 py-0.5 text-[10.5px] font-semibold text-cuerpo">
                          {s.seccion} ×{s.n}
                        </span>
                      ))}
                      {p.faltan.length > 0 && (
                        <span className="text-[11px] font-semibold text-[#9A6A0E]">no abrió: {p.faltan.join(" · ")}</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Sin actividad en la ventana ── */}
      {(entraronSinNavegar.length > 0 || nuncaEntraron.length > 0) && (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Sin actividad en la ventana ({entraronSinNavegar.length + nuncaEntraron.length})
          </h2>
          <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {[...entraronSinNavegar, ...nuncaEntraron].map((p) => {
              const t = ROL_TONO[p.rol] ?? ROL_TONO.cobrador;
              const entro = !!p.ultimoAccesoIso;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                  <span className="min-w-0 truncate text-[13.5px] font-bold text-tinta">{p.nombre}</span>
                  {p.zona && <span className="flex-shrink-0 text-[11.5px] font-semibold text-tenue">{p.zona.replace("Zona ", "")}</span>}
                  <ChipClave p={p} />
                  <span
                    className={`ml-auto flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${entro ? "bg-[#FDF3E2] text-[#9A6A0E]" : "bg-[#FBE4E2] text-[#C0392B]"}`}
                  >
                    {entro ? `entró ${hace(p.ultimoAccesoIso)} · no navegó` : "nunca entró"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Actividad reciente — quién fue a dónde y cuándo */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
        <h2 className="mb-3 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Actividad reciente ({reciente.length})</h2>
        {reciente.length === 0 ? (
          <p className="text-[13px] font-medium text-gris">Todavía sin navegaciones. Aparecerán acá apenas el personal use la app.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linea">
            {reciente.map((e, i) => {
              const t = ROL_TONO[e.rol] ?? ROL_TONO.cobrador;
              return (
                <li key={i} className="flex items-center gap-2.5 py-2">
                  <span className="w-24 flex-shrink-0 text-[11px] font-medium text-tenue tabular-nums">{horaUY(e.creadoEn)}</span>
                  <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                  <span className="w-28 flex-shrink-0 truncate text-[13px] font-bold text-tinta">{e.nombre}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-cuerpo">{e.seccion}</span>
                  <span className="hidden flex-shrink-0 truncate font-mono text-[11px] text-tenue-2 md:block">{e.path}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[18px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{valor}</span>
    </div>
  );
}

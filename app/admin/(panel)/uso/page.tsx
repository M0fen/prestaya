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
  PILOTO_ARRANQUE_UY,
  type UsoPersona,
} from "@/lib/data/uso";
import { UYU } from "@/lib/format";
import { inicioDiaUYIso, diaUYInicioIso } from "@/lib/fecha";

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
  // Ventanas: HOY (¿quién está trabajando ahora?), 7 y 15 días (la quincena, que es
  // la cadencia con la que se paga), 30, y ARRANQUE — la referencia limpia desde
  // que el piloto es real. Antes solo había 7/30/90: ninguna respondía "hoy".
  const VENTANAS = [
    ["hoy", "Hoy"],
    ["7", "7 días"],
    ["15", "15 días"],
    ["30", "30 días"],
    ["arranque", "Desde el arranque"],
  ] as const;
  type Ventana = (typeof VENTANAS)[number][0];
  const ventana: Ventana =
    (VENTANAS.find(([id]) => id === sp.dias)?.[0] as Ventana | undefined) ?? "hoy";
  const desdeIso =
    ventana === "hoy"
      ? inicioDiaUYIso()
      : ventana === "arranque"
        ? diaUYInicioIso(PILOTO_ARRANQUE_UY)
        : new Date(Date.now() - Number(ventana) * 86400000).toISOString();
  const ventanaLabel = VENTANAS.find(([id]) => id === ventana)![1];
  const rolF = sp.rol === "cobrador" || sp.rol === "supervisor" || sp.rol === "admin" ? sp.rol : undefined;
  const zonaF = (sp.z ?? "").trim() || undefined; // nombre de zona, o "—" = sin zona
  const q = (sp.q ?? "").trim();
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    p.set("dias", ventana);
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
            Historial de navegación ({eventos.length}) · {ventanaLabel.toLowerCase()}
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
  // ⚠️ "Entró" se mide por NAVEGACIÓN, no por `last_sign_in_at`. El login es un
  // dato contaminado: cualquier script que valide credenciales lo pisa para todos
  // (pasó el 08-05 y dejó "Sin entrar: 0" con 40 personas que nunca abrieron nada).
  // La navegación solo la genera una persona usando la app.
  const seEstrenaron = filtradas.filter((p) => p.vistas === 0 && p.estrenoIso);
  const nuncaEntraron = filtradas.filter((p) => p.vistas === 0 && !p.estrenoIso);

  const reciente = await getActividadReciente(120, rolF);
  const conClave = filtradas.filter((p) => p.claveCambiadaIso).length;
  const cobrando = filtradas.filter((p) => p.cobrosHoy > 0).length;
  const conectadosHoy = filtradas.filter((p) => p.vistasHoy > 0).length;
  const cobradoHoyTotal = filtradas.reduce((s, p) => s + p.cobradoHoy, 0);
  // Pico de actividad de un día, para escalar las mini-barras de todas las filas
  // con la MISMA vara (si cada fila se escalara sola, un cobrador con 5 vistas se
  // vería igual de activo que uno con 200).
  const pico = Math.max(1, ...activos.flatMap((p) => p.porDia.map((d) => d.n)));

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
            {VENTANAS.map(([id, label]) => (
              <Link key={id} href={qs({ dias: id })} className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${ventana === id ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"}`}>{label}</Link>
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
            <input type="hidden" name="dias" value={ventana} />
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
        <Kpi
          label="🟢 Conectados hoy"
          valor={`${conectadosHoy}/${filtradas.length}`}
          sub={conectadosHoy === 0 ? "nadie abrió la app todavía" : "abrieron la app hoy"}
          tono={conectadosHoy > 0 ? "#157A50" : "#9A6A0E"}
        />
        <Kpi
          label="💵 Cobrando hoy"
          valor={String(cobrando)}
          sub={cobradoHoyTotal > 0 ? UYU(cobradoHoyTotal) : "sin cobros aún"}
          tono={cobrando > 0 ? "#1E47C8" : undefined}
        />
        <Kpi
          label={`Usando la app · ${ventanaLabel.toLowerCase()}`}
          valor={String(activos.length)}
          sub={`de ${filtradas.length} con credenciales`}
          tono="#157A50"
        />
        <Kpi
          label="Nunca abrió la app"
          valor={String(nuncaEntraron.length)}
          sub={nuncaEntraron.length > 0 ? "no navegaron NUNCA" : "todos se estrenaron"}
          tono={nuncaEntraron.length > 0 ? "#C0392B" : "#157A50"}
        />
        <Kpi
          label="🔑 Clave propia"
          valor={`${conClave}/${filtradas.length}`}
          sub={conClave < filtradas.length ? `${filtradas.length - conClave} con la de arranque` : "todos la cambiaron"}
          tono={conClave === filtradas.length ? "#157A50" : "#9A6A0E"}
        />
      </div>

      <p className="rounded-[12px] border border-borde bg-azul-suave px-4 py-2.5 text-[12px] leading-[1.5] font-medium text-cuerpo">
        📡 <b>«Entró» se mide por lo que NAVEGA, no por el login.</b> El último acceso lo pisa cualquier script que
        valide credenciales —pasó el 05-08 y dejó «Sin entrar: 0» con gente que nunca abrió nada—; la navegación,
        en cambio, solo la genera una persona usando la app.{" "}
        <b>«Desde el arranque»</b> mide a partir del {PILOTO_ARRANQUE_UY} (día 1 real del piloto): lo anterior fue
        preparación y pruebas. «🔑 de arranque» = todavía no puso su contraseña propia.
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
                    {/* Una sola línea legible: cuántas VECES abrió la app (no cuántos
                        clics dio), en cuántos días, y en qué anduvo. Las mini-barras
                        muestran de un vistazo si viene sostenido o si se cayó. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-medium text-gris tabular-nums">
                      <Barras porDia={p.porDia} pico={pico} />
                      <span>
                        <b className="text-tinta">{p.sesiones}</b> {p.sesiones === 1 ? "vez" : "veces"} · {p.diasActivos}{" "}
                        {p.diasActivos === 1 ? "día" : "días"}
                      </span>
                      {p.acciones > 0 && <span>{p.acciones} acciones</span>}
                      <span className="text-tenue-2">·</span>
                      <span className="min-w-0 truncate">
                        {p.secciones.slice(0, 3).map((s) => s.seccion.replace(" (cobrador)", "")).join(" · ")}
                        {p.secciones.length > 3 && ` +${p.secciones.length - 3}`}
                      </span>
                      {p.faltan.length > 0 && (
                        <span className="ml-auto flex-shrink-0 rounded-full bg-[#FDF3E2] px-2 py-0.5 text-[10.5px] font-bold text-[#9A6A0E]">
                          sin usar: {p.faltan.length}
                        </span>
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
      {(seEstrenaron.length > 0 || nuncaEntraron.length > 0) && (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Sin actividad · {ventanaLabel.toLowerCase()} ({seEstrenaron.length + nuncaEntraron.length})
            {nuncaEntraron.length > 0 && (
              <span className="ml-2 text-[#C0392B] normal-case">
                — {nuncaEntraron.length} nunca abrieron la app
              </span>
            )}
          </h2>
          <ul className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            {[...seEstrenaron, ...nuncaEntraron].map((p) => {
              const t = ROL_TONO[p.rol] ?? ROL_TONO.cobrador;
              const entro = !!p.estrenoIso;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                  <span className="min-w-0 truncate text-[13.5px] font-bold text-tinta">{p.nombre}</span>
                  {p.zona && <span className="flex-shrink-0 text-[11.5px] font-semibold text-tenue">{p.zona.replace("Zona ", "")}</span>}
                  <ChipClave p={p} />
                  <span
                    className={`ml-auto flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${entro ? "bg-[#FDF3E2] text-[#9A6A0E]" : "bg-[#FBE4E2] text-[#C0392B]"}`}
                  >
                    {entro ? `se estrenó ${hace(p.estrenoIso)} · nada en esta ventana` : "NUNCA abrió la app"}
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

function Kpi({ label, valor, sub, tono }: { label: string; valor: string; sub?: string; tono?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[18px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{valor}</span>
      {sub && <span className="truncate text-[10.5px] font-medium text-tenue-2">{sub}</span>}
    </div>
  );
}

/** Mini-barras de actividad por día. Todas las filas comparten la misma escala
 *  (`pico`), si no una persona con 5 vistas se ve tan activa como una con 200. */
function Barras({ porDia, pico }: { porDia: { dia: string; n: number }[]; pico: number }) {
  if (porDia.length <= 1) return null;
  const ultimos = porDia.slice(-14);
  return (
    <span className="flex h-5 flex-shrink-0 items-end gap-[2px]" title={ultimos.map((d) => `${d.dia}: ${d.n}`).join("\n")}>
      {ultimos.map((d) => (
        <span
          key={d.dia}
          className="w-[4px] rounded-[1px] bg-[#1FA971]"
          style={{ height: `${Math.max(12, Math.round((d.n / pico) * 100))}%`, opacity: 0.35 + 0.65 * (d.n / pico) }}
        />
      ))}
    </span>
  );
}

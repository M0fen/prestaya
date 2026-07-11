// Auditoría de comportamiento del personal (DEV-gated). Control total: quién usa
// la app y quién no, bajo qué perfil, a QUÉ sección fue y por dónde navegó.
// Combina navegación (eventos_uso 0064), último acceso, acciones reales y cobertura.
import Link from "next/link";
import { requireDev } from "@/lib/auth";
import {
  getAuditoriaComportamiento,
  getActividadReciente,
  getEventosDePersona,
  type UsoPersona,
} from "@/lib/data/uso";

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

function estado(p: UsoPersona): { txt: string; bg: string; fg: string } {
  if (p.vistas > 0) return { txt: "Activo", bg: "#E4F5EC", fg: "#157A50" };
  if (p.ultimoAccesoIso) return { txt: "No usó", bg: "#FDF3E2", fg: "#9A6A0E" };
  return { txt: "Nunca entró", bg: "#FBE4E2", fg: "#C0392B" };
}

export default async function UsoPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; rol?: string; u?: string }>;
}) {
  await requireDev();
  const sp = await searchParams;
  const dias = sp.dias === "7" ? 7 : sp.dias === "90" ? 90 : 30;
  const desdeIso = new Date(Date.now() - dias * 86400000).toISOString();
  const rolF = sp.rol === "cobrador" || sp.rol === "supervisor" || sp.rol === "admin" ? sp.rol : undefined;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    p.set("dias", String(dias));
    if (rolF) p.set("rol", rolF);
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
  const puntaje = (p: UsoPersona) =>
    (p.ultimoAccesoIso ? 0 : 1000) + (p.vistas === 0 ? 500 : 0) + p.faltan.length * 10 - p.vistas;
  const orden = [...personas]
    .filter((p) => !rolF || p.rol === rolF)
    .sort((a, b) => puntaje(b) - puntaje(a));
  const reciente = await getActividadReciente(120, rolF);
  const totalVistas = personas.reduce((s, p) => s + p.vistas, 0);
  const credenciados = personas.filter((p) => p.rol !== "admin");
  const sinUsar = credenciados.filter((p) => p.vistas === 0).length;

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
        {/* Filtro por perfil */}
        <div className="flex flex-wrap gap-1.5">
          {([[undefined, "Todos"], ["cobrador", "Cobradores"], ["supervisor", "Supervisores"], ["admin", "Admin"]] as const).map(([id, label]) => (
            <Link key={label} href={qs({ rol: id })} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${rolF === id ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris"}`}>{label}</Link>
          ))}
        </div>
      </header>

      {/* Nota: la telemetría es hacia adelante desde 0064. */}
      <p className="rounded-[12px] border border-borde bg-azul-suave px-4 py-2.5 text-[12px] font-medium text-cuerpo">
        📡 Se registra desde que corriste la migración. Cada perfil aparece con datos <b>a medida que entra y navega</b> —
        los que diste credenciales figuran como <b>“Nunca entró”</b> o <b>“No usó”</b> hasta que empiecen a usarla.
      </p>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Con credenciales" valor={String(credenciados.length)} />
        <Kpi label="Sin usar (credenciados)" valor={String(sinUsar)} tono={sinUsar > 0 ? "#C0392B" : "#157A50"} />
        <Kpi label="Navegaciones" valor={totalVistas.toLocaleString("es-UY")} tono="#1E47C8" />
        <Kpi label="Ventana" valor={`${dias} días`} />
      </div>

      {/* Por persona */}
      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Por persona {rolF ? `· ${rolF}es` : ""} ({orden.length})
        </h2>
        {orden.map((p) => {
          const t = ROL_TONO[p.rol] ?? ROL_TONO.cobrador;
          const st = estado(p);
          return (
            <Link
              key={p.id}
              href={qs({ u: p.id })}
              className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)] transition-colors hover:border-azul"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                    <span className="truncate text-[15px] font-extrabold text-tinta">{p.nombre}</span>
                    <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: st.bg, color: st.fg }}>{st.txt}</span>
                  </div>
                  <span className="text-[12px] font-medium text-gris">
                    Último acceso {hace(p.ultimoAccesoIso)} · última vista {hace(p.ultimaVistaIso)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <Metric n={p.vistas} label="vistas" />
                  <Metric n={p.diasActivos} label="días" />
                  <Metric n={p.acciones} label="acciones" />
                </div>
              </div>
              {p.faltan.length > 0 && p.vistas > 0 && (
                <p className="rounded-[10px] bg-[#FDF3E2] px-3 py-2 text-[12px] font-semibold text-[#9A6A0E]">
                  Brecha — no abrió: <b>{p.faltan.join(" · ")}</b>
                </p>
              )}
              {p.secciones.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.secciones.slice(0, 10).map((s) => (
                    <span key={s.seccion} className="rounded-full bg-suave px-2.5 py-1 text-[11px] font-semibold text-cuerpo">
                      {s.seccion} <span className="text-tenue tabular-nums">×{s.n}</span>
                    </span>
                  ))}
                </div>
              )}
              <span className="text-[11.5px] font-bold text-azul">Ver historial completo →</span>
            </Link>
          );
        })}
      </section>

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

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[16px] font-extrabold text-tinta tabular-nums">{n}</span>
      <span className="text-[10px] font-medium text-tenue">{label}</span>
    </div>
  );
}

// Auditoría de comportamiento del personal (DEV-gated). Combina navegación,
// último acceso, acciones reales y cobertura de secciones por rol → para auditar
// la capacitación de quienes tienen credenciales. Ver lib/data/uso.ts + 0064.
import Link from "next/link";
import { requireDev } from "@/lib/auth";
import { getAuditoriaComportamiento, getActividadReciente, type UsoPersona } from "@/lib/data/uso";

export const dynamic = "force-dynamic";

const ROL_TONO: Record<string, { bg: string; fg: string; label: string }> = {
  admin: { bg: "#EEF3FF", fg: "#1E47C8", label: "Admin" },
  supervisor: { bg: "#EAF7F1", fg: "#157A50", label: "Supervisor" },
  cobrador: { bg: "#F1F3F9", fg: "#6B7494", label: "Cobrador" },
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
  const mo = Math.floor(d / 30);
  return `hace ${mo} mes${mo === 1 ? "" : "es"}`;
}

export default async function UsoPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireDev();
  const sp = await searchParams;
  const dias = sp.dias === "7" ? 7 : sp.dias === "90" ? 90 : 30;
  const desdeIso = new Date(Date.now() - dias * 86400000).toISOString();

  const [personas, reciente] = await Promise.all([
    getAuditoriaComportamiento(desdeIso),
    getActividadReciente(60),
  ]);

  // Orden: más "en riesgo de capacitación" primero (nunca entró / sin vistas / con brechas).
  const puntaje = (p: UsoPersona) =>
    (p.ultimoAccesoIso ? 0 : 1000) + (p.vistas === 0 ? 500 : 0) + p.faltan.length * 10 - p.vistas;
  const orden = [...personas].sort((a, b) => puntaje(b) - puntaje(a));

  const totalVistas = personas.reduce((s, p) => s + p.vistas, 0);
  const sinEntrar = personas.filter((p) => p.vistas === 0).length;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Auditoría de uso del personal</h1>
          <span className="text-[13px] font-medium text-gris">
            Qué sección abre cada quien, bajo qué rol, cuándo entró y qué no tocó — para auditar la capacitación.
          </span>
        </div>
        <div className="flex rounded-full bg-suave p-0.5">
          {([["7", "7 días"], ["30", "30 días"], ["90", "90 días"]] as const).map(([id, label]) => (
            <Link
              key={id}
              href={`/admin/uso?dias=${id}`}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                String(dias) === id ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </header>

      {/* Franja resumen */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Personas" valor={String(personas.length)} />
        <Kpi label="Navegaciones" valor={totalVistas.toLocaleString("es-UY")} tono="#1E47C8" />
        <Kpi label="Sin entrar" valor={String(sinEntrar)} tono={sinEntrar > 0 ? "#C0392B" : "#157A50"} />
        <Kpi label="Ventana" valor={`${dias} días`} />
      </div>

      {/* Por persona */}
      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Por persona</h2>
        {orden.map((p) => {
          const t = ROL_TONO[p.rol] ?? ROL_TONO.cobrador;
          const inactivo = p.vistas === 0;
          return (
            <div
              key={p.id}
              className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                      style={{ background: t.bg, color: t.fg }}
                    >
                      {t.label}
                    </span>
                    <span className="truncate text-[15px] font-extrabold text-tinta">{p.nombre}</span>
                  </div>
                  <span className="text-[12px] font-medium text-gris">
                    Último acceso {hace(p.ultimoAccesoIso)} · última vista {hace(p.ultimaVistaIso)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <Metric n={p.vistas} label="vistas" />
                  <Metric n={p.diasActivos} label="días activos" />
                  <Metric n={p.acciones} label="acciones" />
                </div>
              </div>

              {inactivo ? (
                <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-semibold text-[#C0392B]">
                  ⚠️ No registró NINGUNA navegación en la ventana{p.ultimoAccesoIso ? " (aunque tiene login)" : " ni inició sesión"}.
                </p>
              ) : (
                <>
                  {p.faltan.length > 0 && (
                    <p className="rounded-[10px] bg-[#FDF3E2] px-3 py-2 text-[12px] font-semibold text-[#9A6A0E]">
                      Brecha de capacitación — no abrió: <b>{p.faltan.join(" · ")}</b>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {p.secciones.slice(0, 8).map((s) => (
                      <span
                        key={s.seccion}
                        className="rounded-full bg-suave px-2.5 py-1 text-[11px] font-semibold text-cuerpo"
                      >
                        {s.seccion} <span className="text-tenue tabular-nums">×{s.n}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>

      {/* Actividad reciente */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4 shadow-[0_1px_3px_rgba(19,48,140,0.06)]">
        <h2 className="mb-3 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Actividad reciente</h2>
        {reciente.length === 0 ? (
          <p className="text-[13px] font-medium text-gris">
            Todavía sin navegaciones registradas. Aparecerán acá a medida que el personal use la app (requiere la
            migración 0064 corrida).
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-linea">
            {reciente.map((e, i) => {
              const t = ROL_TONO[e.rol] ?? ROL_TONO.cobrador;
              return (
                <li key={i} className="flex items-center gap-3 py-2">
                  <span
                    className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    {t.label}
                  </span>
                  <span className="w-32 flex-shrink-0 truncate text-[13px] font-bold text-tinta">{e.nombre}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-cuerpo">{e.seccion}</span>
                  <span className="flex-shrink-0 text-[11.5px] font-medium text-tenue tabular-nums">
                    {hace(e.creadoEn)}
                  </span>
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
      <span className="text-[18px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {valor}
      </span>
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

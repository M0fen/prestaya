// Centro de alertas de VIGILANCIA (admin/supervisor): una sola bandeja con las
// señales anti-fuga del día (faltantes, sin rendir, no-pago sospechoso, fuera de
// zona, float alto, desembolsos grandes) + el ranking de CONFIANZA de cobradores
// con su cuenta corriente. El supervisor ve solo su zona.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getCentroAlertas, type SeveridadAlerta, type Alerta } from "@/lib/data/centroAlertas";
import { getVigilanciaCobradores } from "@/lib/data/vigilancia";
import { conTimeout } from "@/lib/timeout";
import { AvisarCobrador } from "@/components/admin/AvisarCobrador";
import { UYU } from "@/lib/format";
import type { BandaConfianza } from "@/lib/scoreCobrador";

export const dynamic = "force-dynamic";

// Un agregado colgado LANZA → error.tsx del panel ("Reintentar"), no un 504.
const TOPE_MS = 22_000;

const SEV: Record<SeveridadAlerta, { label: string; bg: string; text: string; dot: string }> = {
  alta: { label: "Alta", bg: "bg-rojo-suave", text: "text-rojo-osc", dot: "#D64545" },
  media: { label: "Media", bg: "bg-ambar-suave", text: "text-ambar-osc", dot: "#E8A317" },
  baja: { label: "Baja", bg: "bg-suave", text: "text-gris", dot: "#8A93AD" },
};

const BANDA: Record<BandaConfianza, { label: string; color: string }> = {
  intachable: { label: "Intachable", color: "#1FA971" },
  confiable: { label: "Confiable", color: "#2453DC" },
  observar: { label: "Observar", color: "#E8A317" },
  riesgo: { label: "Riesgo", color: "#D64545" },
};
// Color del TEXTO de la banda (sobre tarjeta): tokens que flipean en dark. El
// `color` de arriba se usa como fondo del avatar (círculo lleno, texto blanco),
// donde el color saturado va bien en ambos modos.
const BANDA_TXT: Record<BandaConfianza, string> = {
  intachable: "var(--color-verde-osc)",
  confiable: "var(--color-azul)",
  observar: "var(--color-ambar-osc)",
  riesgo: "var(--color-rojo-osc)",
};

export default async function AlertasPage() {
  await requireGestor();
  const hoy = new Date();
  const db = await createSupabaseServer();
  const alcance = await alcanceDelActor();

  const [centro, cobradores] = await conTimeout(
    Promise.all([
      getCentroAlertas(db, hoy, alcance),
      getVigilanciaCobradores(db, hoy, { alcance }),
    ]),
    TOPE_MS,
    "admin.alertas",
  );
  // Solo los que hay que mirar (no intachables/confiables) primero; el resto abajo.
  const aVigilar = cobradores.filter((c) => c.confianza.banda === "riesgo" || c.confianza.banda === "observar");
  // Bandeja: las 7 más urgentes a la vista; el resto colapsado (no abruma; ya
  // vienen ordenadas por severidad).
  const visibles = centro.alertas.slice(0, 7);
  const resto = centro.alertas.slice(7);

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Centro de alertas</h1>
          <span className="text-[13px] font-medium text-gris">
            Todo lo que hay que vigilar hoy, en un solo lugar. Anti-fuga.
          </span>
        </div>
        <div className="flex gap-2">
          <Chip n={centro.conteo.alta} label="altas" color="#D64545" />
          <Chip n={centro.conteo.media} label="medias" color="#E8A317" />
        </div>
      </div>

      {/* Bandeja de alertas del día (las 7 más urgentes; el resto colapsado). */}
      <section className="flex flex-col gap-2">
        {centro.alertas.length === 0 ? (
          <p className="rounded-[16px] border border-borde bg-tarjeta p-6 text-center text-[13px] font-medium text-verde">
            🎉 Sin alertas hoy. La operación viene limpia.
          </p>
        ) : (
          <>
            {visibles.map((a) => (
              <AlertaCard key={a.id} a={a} />
            ))}
            {resto.length > 0 && (
              <details className="rounded-[14px] border border-borde bg-tarjeta">
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-tinta">
                  Ver {resto.length} alerta{resto.length === 1 ? "" : "s"} más
                </summary>
                <div className="flex flex-col gap-2 p-3 pt-0">
                  {resto.map((a) => (
                    <AlertaCard key={a.id} a={a} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>

      {/* Confianza de cobradores + cuenta corriente (ventana 30 días) */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-extrabold text-tinta">Confianza de cobradores</h2>
          <span className="text-[12px] font-medium text-gris">
            Últimos 30 días. Menor puntaje = mirar primero. La cuenta corriente muestra recaudado vs
            rendido y el float sin declarar.
          </span>
        </div>

        {aVigilar.length > 0 && (
          <div className="flex flex-col gap-2">
            {aVigilar.map((c) => (
              <FilaCobrador key={c.cobradorId} c={c} />
            ))}
          </div>
        )}

        <details className="rounded-[14px] border border-borde bg-tarjeta">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-tinta">
            Ver todos los cobradores ({cobradores.length})
          </summary>
          <div className="flex flex-col gap-2 p-3 pt-0">
            {cobradores.map((c) => (
              <FilaCobrador key={c.cobradorId} c={c} />
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}

/** Tarjeta de una alerta: categoría + título + detalle + acción ("Ver y actuar"
 *  y "Avisar" al cobrador si aplica). Se reusa en la lista y en el colapsado. */
function AlertaCard({ a }: { a: Alerta }) {
  const s = SEV[a.severidad];
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: s.dot }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${s.bg} ${s.text}`}>
            {a.categoria}
          </span>
          <span className="text-[13.5px] font-bold text-tinta">{a.titulo}</span>
        </div>
        <span className="text-[12px] font-medium text-gris">{a.detalle}</span>
        {(a.href || a.cobradorId) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {a.href && (
              <Link href={a.href} className="text-[12px] font-bold text-azul hover:underline">
                Ver y actuar →
              </Link>
            )}
            {a.cobradorId && (
              <AvisarCobrador cobradorId={a.cobradorId} nombre={a.cobradorNombre ?? "cobrador"} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-tinta tabular-nums"
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {n} {label}
    </span>
  );
}

function FilaCobrador({
  c,
}: {
  c: Awaited<ReturnType<typeof getVigilanciaCobradores>>[number];
}) {
  const b = BANDA[c.confianza.banda];
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white tabular-nums"
            style={{ background: b.color }}
          >
            {c.confianza.puntaje}
          </div>
          <div className="flex flex-col">
            <span className="text-[13.5px] font-bold text-tinta">{c.nombre}</span>
            <span className="text-[11.5px] font-semibold" style={{ color: BANDA_TXT[c.confianza.banda] }}>
              {b.label}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-right">
          <Mini label="Recaudó" valor={UYU(c.recaudado)} />
          <Mini label="Rindió" valor={UYU(c.rendido)} />
          <Mini
            label="Sin rendir"
            valor={UYU(c.saldoSinRendir)}
            alerta={c.saldoSinRendir > 0}
          />
          <Mini
            label="Dif. acum."
            valor={UYU(c.diferenciaAcumulada)}
            alerta={c.diferenciaAcumulada < 0}
          />
        </div>
      </div>
      {c.confianza.motivos.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {c.confianza.motivos.map((m, i) => (
            <li key={i} className="text-[11.5px] font-medium text-gris">
              · {m}
            </li>
          ))}
        </ul>
      )}
      {/* Diagnóstico → acción: entrar al campo del cobrador o avisarle sin salir. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-linea pt-2.5">
        <Link href="/admin/campo" className="text-[12px] font-bold text-azul hover:underline">
          Ver en campo →
        </Link>
        <AvisarCobrador cobradorId={c.cobradorId} nombre={c.nombre} />
      </div>
    </div>
  );
}

function Mini({ label, valor, alerta = false }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wide text-tenue">{label}</span>
      <span className={`text-[13px] font-extrabold tabular-nums ${alerta ? "text-rojo-osc" : "text-tinta"}`}>
        {valor}
      </span>
    </div>
  );
}

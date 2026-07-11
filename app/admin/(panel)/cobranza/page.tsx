// Torre de control anti-fuga (admin/supervisor): KPIs del día, alertas de
// anomalía, mapa de calor de cobros (GPS) y ranking de cobradores. Datos reales.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getControlCobranza, type Severidad } from "@/lib/data/control";
import { getRecaudoHoy } from "@/lib/data/recaudoHoy";
import { getActivosConPagos } from "@/lib/data/activos";
import { alcanceDelActor } from "@/lib/data/alcance";
import { MapaCobranza } from "@/components/admin/MapaCobranza";
import { AutoRefresco } from "@/components/admin/AutoRefresco";
import { AvisarCobrador } from "@/components/admin/AvisarCobrador";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEV: Record<Severidad, { bg: string; fg: string; dot: string }> = {
  alta: { bg: "#FDECEA", fg: "#C0392B", dot: "#E74C3C" },
  media: { bg: "#FDF3E2", fg: "#B9770E", dot: "#E0A13C" },
  baja: { bg: "#EEF1F8", fg: "#5B6478", dot: "#8A93AD" },
};

export default async function CobranzaPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  // Alcance una vez (admin = todo; supervisor = su zona) → control y recaudo consistentes.
  const alcance = await alcanceDelActor();
  // Perf: la cartera activa (RPC) se trae UNA vez y se comparte: el control la usa
  // para el mapa/ranking y el recaudo para clasificar ruta/cerrados sin re-consultar
  // estados. Antes el control la traía y el recaudo consultaba `prestamos.estado` aparte.
  const activos = await getActivosConPagos(db, alcance);
  const activosIds = new Set(activos.map((a) => a.id));
  const [{ resumen, ranking, alertas, mapaCobros }, rec] = await Promise.all([
    getControlCobranza(db, undefined, activos, alcance),
    getRecaudoHoy(db, undefined, alcance, activosIds),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
            Cobranza · control anti-fuga
          </h1>
          <span className="text-[13px] font-medium text-gris">
            Cada peso con hora, lugar y trazabilidad.
          </span>
        </div>
        <AutoRefresco segundos={40} />
      </div>

      {/* Resumen (esta pantalla mira SOLO la ruta activa; el total del día está abajo) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cobrado en ruta hoy" valor={UYU(rec.enRuta)} acento="var(--color-verde-osc)" />
        <Kpi label="Cobros en ruta" valor={String(rec.cobrosRuta)} acento="var(--color-azul)" />
        <Kpi label="Fuera de zona" valor={String(resumen.fueraZona)} acento="var(--color-rojo-osc)" alerta={resumen.fueraZona > 0} />
        <Kpi label="Cobradores" valor={String(resumen.cobradores)} acento="var(--color-tinta)" />
      </div>

      {/* Aclaración: por qué este número puede ser MENOR que el "Recaudado hoy" del panel. */}
      <div className="rounded-[14px] border border-borde bg-suave px-4 py-3">
        <p className="text-[12px] leading-[1.6] font-medium text-gris">
          Esta pantalla es de <b>control de la ruta</b>: cuenta solo los cobros de HOY en{" "}
          <b>créditos activos</b> (con GPS, para detectar fuga). El <b>recaudo TOTAL del día</b> —incluyendo pagos
          en créditos ya cerrados/históricos— es{" "}
          <b className="text-tinta">{UYU(rec.total)}</b>
          {rec.enCerrados > 0 && <> (hay {UYU(rec.enCerrados)} en créditos cerrados)</>}, y lo ves en el{" "}
          <Link href="/admin" className="font-bold text-azul">Dashboard</Link>. Los dos números son
          correctos: miden cosas distintas.
        </p>
      </div>

      {/* Alertas */}
      <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-extrabold text-tinta">Alertas de fuga</h2>
          <span className="rounded-full bg-[#FCE8E8] px-2.5 py-0.5 text-[11.5px] font-bold text-[#C0392B]">
            {alertas.length}
          </span>
        </div>
        {alertas.length === 0 && (
          <span className="text-[12.5px] font-medium text-gris">
            Sin anomalías hoy. Todo en orden ✓
          </span>
        )}
        {alertas.map((a) => {
          const s = SEV[a.severidad];
          return (
            <div key={a.id} className="flex items-start gap-2.5 rounded-[12px] px-3 py-2.5" style={{ background: s.bg }}>
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.dot }} />
              <div className="flex flex-col">
                <span className="text-[13px] font-bold" style={{ color: s.fg }}>
                  {a.titulo}
                </span>
                <span className="text-[11.5px] font-medium text-gris">{a.detalle}</span>
              </div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Mapa geográfico de cobros */}
        <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-5">
          <h2 className="text-[15px] font-extrabold text-tinta">Mapa de cobros de hoy</h2>
          <MapaCobranza puntos={mapaCobros} />
        </section>

        {/* Ranking */}
        <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-5">
          <h2 className="text-[15px] font-extrabold text-tinta">Ranking de cobradores</h2>
          {ranking.length === 0 && (
            <span className="text-[12.5px] font-medium text-gris">
              No hay cobradores activos.
            </span>
          )}
          {ranking.map((r, i) => (
            <div key={r.cobradorId} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-black text-tenue">#{i + 1}</span>
                <span className="flex-1 text-[13.5px] font-bold text-tinta">{r.nombre}</span>
                {r.anomalias > 0 && (
                  <span className="rounded-full bg-[#FCE8E8] px-2 py-0.5 text-[10.5px] font-bold text-[#C0392B]">
                    {r.anomalias} ⚠
                  </span>
                )}
                <span className="text-[13px] font-extrabold text-tinta tabular-nums">
                  {UYU(r.recaudado)}
                </span>
              </div>
              <div className="h-[7px] w-full overflow-hidden rounded-full bg-linea">
                <div
                  className="h-full rounded-full bg-azul"
                  style={{ transformOrigin: "left", transform: `scaleX(${Math.min(1, r.progreso)})` }}
                />
              </div>
              <span className="text-[11px] font-medium text-gris">
                {r.cobrados} cobrados · {r.pendientes} pendientes · esperado {UYU(r.esperado)}
              </span>
              {/* Del ranking pasivo a la acción: entrar a su campo o avisarle sin salir. */}
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/admin/campo" className="text-[11.5px] font-bold text-azul hover:underline">
                  Ver campo →
                </Link>
                <AvisarCobrador cobradorId={r.cobradorId} nombre={r.nombre} />
              </div>
            </div>
          ))}
        </section>
      </div>

      <p className="text-[11px] font-medium text-[#AEB6CC]">
        La geo-cerca requiere que el cliente tenga ubicación guardada (censo con
        GPS). La alerta de “float alto sin rendir” deja de aparecer en cuanto el
        cobrador cierra su jornada en <b>Caja diaria</b>.
      </p>
    </div>
  );
}

function Kpi({
  label,
  valor,
  acento,
  alerta = false,
}: {
  label: string;
  valor: string;
  acento: string;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-borde bg-tarjeta p-4">
      <span className="text-[11.5px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span
        className="text-[23px] font-extrabold tabular-nums"
        style={{ color: alerta ? "var(--color-rojo-osc)" : acento }}
      >
        {valor}
      </span>
    </div>
  );
}

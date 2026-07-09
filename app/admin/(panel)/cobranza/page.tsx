// Torre de control anti-fuga (admin/supervisor): KPIs del día, alertas de
// anomalía, mapa de calor de cobros (GPS) y ranking de cobradores. Datos reales.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getControlCobranza, type Severidad } from "@/lib/data/control";
import { MapaCobranza } from "@/components/admin/MapaCobranza";
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
  const { resumen, ranking, alertas, mapaCobros } = await getControlCobranza(db);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
          Cobranza · control anti-fuga
        </h1>
        <span className="text-[13px] font-medium text-gris">
          Cada peso con hora, lugar y trazabilidad.
        </span>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Recaudado hoy" valor={UYU(resumen.recaudadoHoy)} acento="#1FA971" />
        <Kpi label="Cobros hoy" valor={String(resumen.cobrosHoy)} acento="#1E47C8" />
        <Kpi label="Fuera de zona" valor={String(resumen.fueraZona)} acento="#E06A6A" alerta={resumen.fueraZona > 0} />
        <Kpi label="Cobradores" valor={String(resumen.cobradores)} acento="#7A4DD6" />
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
                <span className="text-[13px] font-black text-[#B3A488]">#{i + 1}</span>
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
              <div className="h-[7px] w-full overflow-hidden rounded-full bg-[#E6EBF5]">
                <div
                  className="h-full rounded-full bg-[#1E47C8]"
                  style={{ transformOrigin: "left", transform: `scaleX(${Math.min(1, r.progreso)})` }}
                />
              </div>
              <span className="text-[11px] font-medium text-gris">
                {r.cobrados} cobrados · {r.pendientes} pendientes · esperado {UYU(r.esperado)}
              </span>
            </div>
          ))}
        </section>
      </div>

      <p className="text-[11px] font-medium text-[#AEB6CC]">
        La geo-cerca requiere que el cliente tenga ubicación guardada (censo con
        GPS). El float es una estimación hasta habilitar el módulo de rendición
        de caja.
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
        style={{ color: alerta ? "#C0392B" : acento }}
      >
        {valor}
      </span>
    </div>
  );
}

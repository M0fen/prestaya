// Panel de ESTADÍSTICAS (solo admin/dueño): crecimiento del negocio, distribución
// de la cartera, comportamiento por cobrador y clientes que más vuelven. Todo
// agregado en SQL (0048) para escalar sobre 158k pagos sin colgar la base.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getEstadisticas } from "@/lib/data/estadisticas";
import { getZonas } from "@/lib/data/zonas";
import { Columnas } from "@/components/charts/Columnas";
import { DesempenoPanel, type CobradorDesempeno } from "@/components/admin/DesempenoPanel";
import { UYU, meses } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Período (en días) para el recaudo por cobrador. Acotado a los presets. */
function diasDe(v: string | undefined): number {
  const n = Number(v);
  return n === 7 || n === 90 ? n : 30;
}

function mesLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(meses[m - 1] ?? "").slice(0, 3)} ${String(y).slice(2)}`;
}

const CALIF: Record<string, { label: string; color: string }> = {
  excelente: { label: "Excelente", color: "#1FA971" },
  bueno: { label: "Bueno", color: "#1E47C8" },
  regular: { label: "Regular", color: "#E8A317" },
  riesgo: { label: "Riesgo", color: "#D64545" },
  nuevo: { label: "Nuevo", color: "#7A4DD6" },
};

export default async function EstadisticasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  await requireAdmin();
  const { dias: diasParam } = await searchParams;
  const dias = diasDe(diasParam);
  const db = await createSupabaseServer();
  const e = await getEstadisticas(db, { meses: 8, dias, topN: 10 });

  if (!e.disponible) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Estadísticas</h1>
        <p className="rounded-[14px] bg-[#FEF9EE] px-4 py-3 text-[13px] font-medium text-[#B7791F]">
          Las estadísticas necesitan una actualización del sistema que todavía no se aplicó.
          Avisale a Carlos (ref: 0048) — el resto del panel funciona normal.
        </p>
      </div>
    );
  }

  // Enriquecer el desempeño por cobrador con su ZONA + ticket promedio (para poder
  // filtrar por zona/persona y leer mejor). Zona = usuarios.zona_id → nombre.
  const cobIds = e.porCobrador.map((c) => c.cobradorId);
  const zonas = await getZonas(db);
  const zonaNombre = new Map(zonas.map((z) => [z.id, z.nombre] as const));
  const zonaDe = new Map<string, string | null>();
  if (cobIds.length > 0) {
    const { data: us } = await db.from("usuarios").select("id, zona_id").in("id", cobIds);
    for (const u of us ?? []) zonaDe.set(u.id as string, (u.zona_id as string | null) ?? null);
  }
  const desempeno: CobradorDesempeno[] = e.porCobrador.map((c) => {
    const zonaId = zonaDe.get(c.cobradorId) ?? null;
    return {
      ...c,
      zonaId,
      zonaNombre: zonaId ? (zonaNombre.get(zonaId) ?? null) : null,
      ticketPromedio: c.cobros > 0 ? Math.round(c.recaudo / c.cobros) : 0,
    };
  });

  const ult = e.mensual.length - 1;
  const colocadoCols = e.mensual.map((m, i) => ({
    etiqueta: mesLabel(m.mes), valor: m.colocado, esHoy: i === ult,
    tooltip: `${mesLabel(m.mes)}: colocó ${UYU(m.colocado)} en ${m.creditosNuevos} créditos`,
  }));
  const recaudadoCols = e.mensual.map((m, i) => ({
    etiqueta: mesLabel(m.mes), valor: m.recaudado, esHoy: i === ult,
    tooltip: `${mesLabel(m.mes)}: recaudó ${UYU(m.recaudado)} en ${m.cobros} cobros`,
  }));
  const nuevosCols = e.mensual.map((m, i) => ({
    etiqueta: mesLabel(m.mes), valor: m.creditosNuevos, esHoy: i === ult,
    tooltip: `${mesLabel(m.mes)}: ${m.creditosNuevos} créditos nuevos`,
  }));
  const altasCols = e.mensual.map((m, i) => ({
    etiqueta: mesLabel(m.mes), valor: m.clientesNuevos, esHoy: i === ult,
    tooltip: `${mesLabel(m.mes)}: ${m.clientesNuevos} clientes nuevos · ${m.cobradoresNuevos} cobradores nuevos`,
  }));

  // Totales del último mes vs el previo (crecimiento).
  const u = e.mensual[ult];
  const p = e.mensual[ult - 1];
  const crec = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

  const maxCapFrec = Math.max(1, ...e.distribucion.frecuencia.map((f) => f.capital));
  const maxCalif = Math.max(1, ...e.distribucion.calificacion.map((c) => c.n));

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Estadísticas del negocio</h1>
        <span className="text-[13px] font-medium text-gris">
          Crecimiento, composición de la cartera y comportamiento — la foto grande para decidir.
        </span>
      </div>

      {/* Crecimiento del mes vs el anterior */}
      {u && (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Delta label="Colocado (mes)" valor={UYU(u.colocado)} pct={p ? crec(u.colocado, p.colocado) : null} />
          <Delta label="Recaudado (mes)" valor={UYU(u.recaudado)} pct={p ? crec(u.recaudado, p.recaudado) : null} />
          <Delta label="Créditos nuevos" valor={String(u.creditosNuevos)} pct={p ? crec(u.creditosNuevos, p.creditosNuevos) : null} />
          <Delta label="Clientes nuevos" valor={String(u.clientesNuevos)} pct={p ? crec(u.clientesNuevos, p.clientesNuevos) : null} />
        </div>
      )}

      {/* Gráficos de crecimiento */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Colocación por mes" nota="capital prestado">
          <Columnas datos={colocadoCols} color="#1E47C8" />
        </Card>
        <Card titulo="Recaudo por mes" nota="cobros recibidos">
          <Columnas datos={recaudadoCols} color="#1FA971" colorHoy="#13308C" />
        </Card>
        <Card titulo="Créditos nuevos por mes" nota="ritmo de colocación">
          <Columnas datos={nuevosCols} color="#7A4DD6" />
        </Card>
        <Card titulo="Altas de clientes por mes" nota="crecimiento de la base">
          <Columnas datos={altasCols} color="#E8A317" />
        </Card>
      </div>

      {/* Distribución de la cartera activa */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Cartera por modalidad" nota="capital activo por frecuencia">
          <div className="flex flex-col gap-2">
            {e.distribucion.frecuencia.map((f) => (
              <Barra key={f.k} etiqueta={`${f.k} · ${f.n} créd.`} valor={UYU(f.capital)} pct={f.capital / maxCapFrec} color="#1E47C8" />
            ))}
          </div>
        </Card>
        <Card titulo="Clientes por calificación" nota="créditos activos por banda">
          <div className="flex flex-col gap-2">
            {e.distribucion.calificacion.map((c) => {
              const cal = CALIF[c.k] ?? CALIF.nuevo;
              return <Barra key={c.k} etiqueta={cal.label} valor={String(c.n)} pct={c.n / maxCalif} color={cal.color} />;
            })}
          </div>
        </Card>
      </div>

      {/* Desempeño por PERSONA con filtros (período/zona/búsqueda) + más columnas. */}
      <DesempenoPanel cobradores={desempeno} zonas={zonas.map((z) => ({ id: z.id, nombre: z.nombre }))} dias={dias} />

      {/* Clientes que más vuelven (recompra) */}
      <Card titulo="Clientes que más vuelven" nota="por cantidad de créditos tomados (fidelidad)">
        <ul className="flex flex-col divide-y divide-linea">
          {e.topClientes.map((c, i) => (
            <li key={c.clienteId} className="flex items-center gap-3 py-2">
              <span className="w-5 text-[12px] font-black text-[#B3A488]">#{i + 1}</span>
              <Link href={`/admin/clientes/${c.clienteId}`} className="flex-1 truncate text-[13px] font-bold text-azul">
                {c.nombre}
              </Link>
              <span className="text-[11.5px] font-medium text-gris">
                {c.creditos} créditos{c.activos > 0 ? ` · ${c.activos} activo${c.activos === 1 ? "" : "s"}` : ""}
              </span>
              <span className="text-[12.5px] font-extrabold tabular-nums text-tinta">{UYU(c.capitalHist)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Los meses se cortan en el día calendario de Uruguay. Colocación por fecha de crédito, recaudo por fecha de
        pago, altas por fecha de registro. Todo agregado en la base (no se estima).
      </p>
    </div>
  );
}

function Card({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-extrabold text-tinta">{titulo}</span>
        {nota && <span className="text-[11px] font-medium text-tenue">{nota}</span>}
      </div>
      {children}
    </section>
  );
}

function Delta({ label, valor, pct }: { label: string; valor: string; pct: number | null }) {
  const tono = pct == null ? "#6B7494" : pct >= 0 ? "#157A50" : "#C0392B";
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[18px] font-extrabold tabular-nums text-tinta">{valor}</span>
      <span className="text-[11px] font-bold tabular-nums" style={{ color: tono }}>
        {pct == null ? "—" : `${pct >= 0 ? "▲ +" : "▼ "}${pct}% vs mes previo`}
      </span>
    </div>
  );
}

function Barra({ etiqueta, valor, pct, color }: { etiqueta: string; valor: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="truncate font-semibold text-cuerpo capitalize">{etiqueta}</span>
        <span className="flex-shrink-0 font-extrabold tabular-nums text-tinta">{valor}</span>
      </div>
      <div className="h-[8px] w-full overflow-hidden rounded-full bg-[#EEF1F8]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round(pct * 100))}%`, background: color }} />
      </div>
    </div>
  );
}

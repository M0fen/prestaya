// Tablero "Valor del sistema" (admin/supervisor): hace visible la razón de la
// inversión con datos reales — trazabilidad auditable, cartera sana y
// crecimiento. Honesto: crece con el volumen; lo estimado se marca.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getValorSistema } from "@/lib/data/valor";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function ValorPage() {
  // Solo el dueño: expone rentabilidad/ROI del negocio (dato privado del admin).
  await requireAdmin();
  const db = await createSupabaseServer();
  const v = await getValorSistema(db);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
          Valor del sistema
        </h1>
        <span className="text-[13px] font-medium text-gris">
          Lo que la herramienta te devuelve, en números.
        </span>
      </div>

      {/* Hero: cobranza gestionada con trazabilidad */}
      <section className="overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#13308C,#1E47C8)] p-5 text-white">
        <span className="text-[12px] font-semibold text-white/60 uppercase">
          Cobranza gestionada este mes
        </span>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[34px] font-black tabular-nums">
            {UYU(v.gestionadoMes)}
          </span>
          <span className="text-[13px] font-semibold text-[#9DF2CE]">
            {pct(v.trazabilidadPct)} auditable · GPS + hora
          </span>
        </div>
        <p className="mt-1 text-[12.5px] font-medium text-white/70">
          {v.cobrosAuditables} de {v.cobrosMes} cobros con ubicación y sello de
          tiempo: imposibles de negar o desviar.
        </p>
      </section>

      {/* Anti-fuga */}
      <Bloque titulo="Control anti-fuga" nota="Cada peso con hora, lugar y libro inmutable.">
        <Metrica label="Cobros auditables" valor={`${v.cobrosAuditables}/${v.cobrosMes}`} acento="#1FA971" />
        <Metrica label="Trazabilidad" valor={pct(v.trazabilidadPct)} acento="#1E47C8" />
        <Metrica label="Libro de pagos" valor="Inmutable ✓" acento="#7A4DD6" />
      </Bloque>

      {/* Cartera sana */}
      <Bloque titulo="Cartera sana" nota="La mora siempre visible y accionable.">
        <Metrica label="Por cobrar" valor={UYU(v.carteraPorCobrar)} acento="#1E47C8" />
        <Metrica label="En mora" valor={UYU(v.montoEnMora)} acento="#E06A6A" alerta={v.montoEnMora > 0} />
        <Metrica label="Mora / cartera" valor={pct(v.moraPct)} acento="#E8A317" />
      </Bloque>

      {/* Crecimiento */}
      <Bloque titulo="Crecimiento" nota="Capital trabajando y rotación de créditos.">
        <Metrica label="Capital colocado" valor={UYU(v.capitalColocado)} acento="#1FA971" />
        <Metrica label="Créditos activos" valor={String(v.creditosActivos)} acento="#1E47C8" />
        <Metrica label="Finalizados" valor={String(v.creditosFinalizados)} acento="#7A4DD6" />
      </Bloque>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Estas cifras crecen con el volumen de operación. La trazabilidad requiere
        que los cobros se registren desde la app del cobrador (GPS + hora); la
        próxima palanca de valor es la renovación pre-aprobada, que convierte a
        los buenos pagadores en más originación.
      </p>
    </div>
  );
}

function Bloque({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-5">
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-[15px] font-extrabold text-tinta">{titulo}</h2>
        <span className="text-[12px] font-medium text-gris">{nota}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
    </section>
  );
}

function Metrica({
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
    <div className="flex min-w-0 flex-col gap-1 rounded-[12px] bg-suave p-3.5">
      <span className="text-[11px] font-semibold text-gris">{label}</span>
      <span
        className="text-[15px] font-extrabold tabular-nums sm:text-[18px]"
        style={{ color: alerta ? "#C0392B" : acento }}
      >
        {valor}
      </span>
    </div>
  );
}

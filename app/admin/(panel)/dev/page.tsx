// Pantalla DEV (solo desarrollador): salud del sistema de un vistazo. Read-only,
// SIN exponer secretos (solo si están o no configurados). Útil para diagnosticar
// la entrega: claves cargadas, migraciones presentes, conteos, datos demo.
import Link from "next/link";
import { requireDev } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getEstadisticas } from "@/lib/data/estadisticas";
import { UYU, meses as MESES } from "@/lib/format";
import type { SupabaseClient } from "@supabase/supabase-js";

function mesCorto(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(MESES[m - 1] ?? "").slice(0, 3)} ${String(y).slice(2)}`;
}

export const dynamic = "force-dynamic";

async function conteo(
  db: SupabaseClient,
  tabla: string,
  eqCol?: string,
  eqVal?: string | boolean,
): Promise<number | null> {
  try {
    const base = db.from(tabla).select("*", { count: "exact", head: true });
    const q = eqCol !== undefined ? base.eq(eqCol, eqVal as string | boolean) : base;
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export default async function DevPage() {
  await requireDev();
  const db = await createSupabaseServer();

  const env = {
    "DeepSeek (Aureo)": !!process.env.DEEPSEEK_API_KEY,
    "Cifrado de chat": !!process.env.CHAT_SECRET_KEY,
    "Push (VAPID)": !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    "Rate limit (Upstash)": !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    "Cron secret": !!process.env.CRON_SECRET,
  };

  const [usuarios, clientes, prestamos, pagos, zonas, demo, devs] = await Promise.all([
    conteo(db, "usuarios"),
    conteo(db, "clientes"),
    conteo(db, "prestamos", "estado", "activo"),
    conteo(db, "pagos", "anulado", false),
    conteo(db, "zonas"),
    conteo(db, "clientes", "notas", "[demo-operador]"),
    conteo(db, "usuarios", "es_dev", true),
  ]);

  // Presencia de tablas de las últimas migraciones (null = falta la migración).
  const tablas = await Promise.all(
    (["zonas", "supervisor_zonas", "solicitudes_anulacion", "solicitudes_renovacion", "bitacora", "mensajes"] as const).map(
      async (t) => [t, (await conteo(db, t)) !== null] as const,
    ),
  );

  // Estadísticas de crecimiento + comportamiento por persona (0048; degrada solo).
  const stats = await getEstadisticas(db, { meses: 6, dias: 30, topN: 8 });

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Dev · salud del sistema</h1>
        <span className="text-[13px] font-medium text-gris">
          Diagnóstico rápido de la instalación. No muestra secretos, solo si están configurados.
        </span>
      </div>

      {/* Claves / features */}
      <Bloque titulo="Claves y features">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(env).map(([k, ok]) => (
            <Fila key={k} label={k} ok={ok} okTxt="configurado" noTxt="falta" />
          ))}
        </div>
      </Bloque>

      {/* Datos */}
      <Bloque titulo="Datos">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Kpi label="Usuarios" valor={usuarios} />
          <Kpi label="Clientes" valor={clientes} />
          <Kpi label="Préstamos activos" valor={prestamos} />
          <Kpi label="Pagos (vigentes)" valor={pagos} />
          <Kpi label="Zonas" valor={zonas} />
          <Kpi label="Desarrolladores" valor={devs} />
        </div>
        {demo != null && demo > 0 && (
          <div className="mt-3 rounded-[10px] bg-[#FFF8E6] px-3 py-2 text-[12px] font-bold text-[#8A6D1E]">
            🧪 Hay {demo} clientes DEMO cargados. Borralos con:
            <code className="ml-1 font-mono">scripts/seed-demo-operador.mjs --limpiar</code>
          </div>
        )}
      </Bloque>

      {/* Migraciones (por presencia de tablas) */}
      <Bloque titulo="Migraciones (tablas presentes)">
        <div className="grid gap-2 sm:grid-cols-2">
          {tablas.map(([t, ok]) => (
            <Fila key={t} label={t} ok={ok} okTxt="ok" noTxt="falta migración" />
          ))}
        </div>
      </Bloque>

      {/* Crecimiento (0048) — degrada solo si la migración no corrió. */}
      {stats.disponible && stats.mensual.length > 0 && (
        <Bloque titulo="Crecimiento (últimos meses)">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-linea text-[10px] font-bold uppercase tracking-wide text-gris">
                  <th className="px-2 py-1.5 text-left">Mes</th>
                  <th className="px-2 py-1.5 text-right">Colocado</th>
                  <th className="px-2 py-1.5 text-right">Recaudado</th>
                  <th className="px-2 py-1.5 text-center">Créd.</th>
                  <th className="px-2 py-1.5 text-center">Clientes</th>
                  <th className="px-2 py-1.5 text-center">Cobrad.</th>
                </tr>
              </thead>
              <tbody>
                {stats.mensual.map((m) => (
                  <tr key={m.mes} className="border-b border-[#F4F6FB]">
                    <td className="px-2 py-1.5 font-semibold text-tinta">{mesCorto(m.mes)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-cuerpo">{UYU(m.colocado)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#157A50]">{UYU(m.recaudado)}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{m.creditosNuevos}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{m.clientesNuevos}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums">{m.cobradoresNuevos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloque>
      )}

      {/* Comportamiento por cobrador (0048) */}
      {stats.disponible && stats.porCobrador.length > 0 && (
        <Bloque titulo="Comportamiento por cobrador (30 días)">
          <div className="flex flex-col divide-y divide-linea">
            {stats.porCobrador.map((c) => (
              <div key={c.cobradorId} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-semibold text-tinta">{c.nombre}</span>
                <span className="text-[11px] text-gris">{c.creditosActivos} créd · {c.cobros} cobros</span>
                <span className="font-extrabold tabular-nums text-[#157A50]">{UYU(c.recaudo)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10.5px] text-tenue">
            Recaudo de los últimos 30 días · panel completo en{" "}
            <Link href="/admin/estadisticas" className="font-bold text-azul">Estadísticas</Link>.
          </p>
        </Bloque>
      )}
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-5">
      <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">{titulo}</span>
      {children}
    </section>
  );
}

function Fila({ label, ok, okTxt, noTxt }: { label: string; ok: boolean; okTxt: string; noTxt: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[10px] bg-suave px-3 py-2">
      <span className="text-[12.5px] font-semibold text-tinta">{label}</span>
      <span
        className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
        style={ok ? { background: "#E4F5EC", color: "#157A50" } : { background: "#FDECEA", color: "#C0392B" }}
      >
        {ok ? `✓ ${okTxt}` : `✕ ${noTxt}`}
      </span>
    </div>
  );
}

function Kpi({ label, valor }: { label: string; valor: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-suave p-3">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span className="text-[18px] font-black tabular-nums text-tinta">{valor ?? "—"}</span>
    </div>
  );
}

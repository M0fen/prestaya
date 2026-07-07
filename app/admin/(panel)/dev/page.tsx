// Pantalla DEV (solo desarrollador): salud del sistema de un vistazo. Read-only,
// SIN exponer secretos (solo si están o no configurados). Útil para diagnosticar
// la entrega: claves cargadas, migraciones presentes, conteos, datos demo.
import { requireDev } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-[#E6EAF4] bg-white p-5">
      <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">{titulo}</span>
      {children}
    </section>
  );
}

function Fila({ label, ok, okTxt, noTxt }: { label: string; ok: boolean; okTxt: string; noTxt: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[10px] bg-[#F7F9FD] px-3 py-2">
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
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-[#F7F9FD] p-3">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[18px] font-black tabular-nums text-tinta">{valor ?? "—"}</span>
    </div>
  );
}

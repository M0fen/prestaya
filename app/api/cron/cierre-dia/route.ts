// ─────────────────────────────────────────────────────────────────────────
//  CRON — "Cierre del día": arma el resumen del día y lo EMPUJA (push) a los
//  gestores (admin/supervisor). Lo dispara Vercel Cron (ver vercel.json).
//  Protegido con CRON_SECRET. Corre con service_role (ve todo). Node runtime
//  (web-push necesita Node). Degrada solito si faltan claves VAPID o la 0026.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getResumenPeriodo } from "@/lib/data/periodo";
import { getRendicionesDia } from "@/lib/data/rendicion";
import { getTableroMora } from "@/lib/data/mora";
import { getSuscripcionesDeRoles, borrarSuscripcionDb } from "@/lib/data/push";
import { enviarPush, pushConfigurado } from "@/lib/push/enviar";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  // Solo Vercel Cron (o quien tenga el secreto). Si no hay secreto configurado,
  // dejamos pasar (útil en dev); en prod SIEMPRE conviene fijar CRON_SECRET.
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new Response("No autorizado", { status: 401 });
  }
  if (!pushConfigurado()) {
    return Response.json({ ok: false, motivo: "VAPID sin configurar" });
  }

  const db = createSupabaseAdmin();
  const [dia, rend, mora] = await Promise.all([
    getResumenPeriodo(db, "dia"),
    getRendicionesDia(db),
    getTableroMora(db),
  ]);

  // Cuerpo del aviso: lo esencial de un vistazo.
  const partes = [`Recaudado ${UYU(dia.recaudado)} · ${dia.cobros} cobros`];
  if (rend.pendientes.length > 0) partes.push(`${rend.pendientes.length} sin rendir`);
  const faltantes = rend.rendidas.filter((r) => r.diferencia < 0).length;
  if (faltantes > 0) partes.push(`${faltantes} con faltante`);
  if (mora.resumen.critico > 0) partes.push(`${mora.resumen.critico} en mora crítica`);

  const payload = {
    titulo: "Cierre del día · Presta Ya",
    cuerpo: partes.join(" · "),
    url: "/admin/cierre",
    tag: "cierre-dia",
  };

  const subs = await getSuscripcionesDeRoles(db, ["admin", "supervisor"]);
  let enviados = 0;
  let limpiados = 0;
  for (const s of subs) {
    const r = await enviarPush(s, payload);
    if (r === "ok") enviados++;
    else if (r === "gone") {
      await borrarSuscripcionDb(db, s.endpoint).catch(() => {});
      limpiados++;
    }
  }

  return Response.json({ ok: true, enviados, limpiados, resumen: payload.cuerpo });
}

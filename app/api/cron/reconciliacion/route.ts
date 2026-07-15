// ─────────────────────────────────────────────────────────────────────────
//  CRON — "Reconciliación de dinero": cada mañana verifica las INVARIANTES de
//  plata (pagado_acum == Σpagos, sin sobre-cobro) vía el RPC 0071 y, si hay algo
//  CRÍTICO (nuevo / material), empuja un aviso a los admins. El baseline de
//  redondeos (severidad media) NO alerta, para que el push signifique "revisá YA".
//  Protegido con CRON_SECRET, corre con service_role. Lo dispara Vercel Cron.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { cronAutorizado } from "@/lib/seguridad/cron";
import { reconciliarDia } from "@/lib/data/reconciliacion";
import { getSuscripcionesDeRoles, borrarSuscripcionDb } from "@/lib/data/push";
import { enviarPush, pushConfigurado } from "@/lib/push/enviar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  // Solo Vercel Cron (o quien tenga el secreto). FALLA CERRADO en producción.
  if (
    !cronAutorizado(
      req.headers.get("authorization"),
      process.env.CRON_SECRET,
      process.env.NODE_ENV === "production",
    )
  ) {
    return new Response("No autorizado", { status: 401 });
  }

  const db = createSupabaseAdmin();
  const r = await reconciliarDia(db);
  if (!r.disponible) {
    return Response.json({ ok: false, motivo: "RPC app_reconciliacion_violaciones sin correr (0071)" });
  }

  // Alerta SOLO ante lo CRÍTICO: drift del denormalizado (los saldos mienten) o
  // sobre-cobro material (se cobró de más de verdad). El baseline de redondeos no.
  let avisados = 0;
  if (r.criticos > 0 && pushConfigurado()) {
    const payload = {
      titulo: "⚠️ Reconciliación: revisar la plata",
      cuerpo: `${r.criticos} hallazgo(s) crítico(s) de dinero (${r.hallazgos.length} en total).`,
      url: "/admin",
      tag: "reconciliacion",
    };
    const subs = await getSuscripcionesDeRoles(db, ["admin"]);
    for (const s of subs) {
      const res = await enviarPush(s, payload);
      if (res === "ok") avisados++;
      else if (res === "gone") await borrarSuscripcionDb(db, s.endpoint).catch(() => {});
    }
  }

  return Response.json({
    ok: r.ok,
    criticos: r.criticos,
    total: r.hallazgos.length,
    porInvariante: r.porInvariante,
    recaudoLibro: r.recaudoLibro,
    avisados,
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  CRON — "Reconciliación de dinero": cada mañana verifica las INVARIANTES de
//  plata (pagado_acum == Σpagos, sin sobre-cobro) vía el RPC 0071 y, si hay algo
//  CRÍTICO (nuevo / material), empuja un aviso a los admins. El baseline de
//  redondeos (severidad media) NO alerta, para que el push signifique "revisá YA".
//  Protegido con CRON_SECRET, corre con service_role. Lo dispara Vercel Cron.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { reportarError } from "@/lib/observabilidad";
import { cronAutorizado } from "@/lib/seguridad/cron";
import { reconciliarDia, logReconciliacion } from "@/lib/data/reconciliacion";
import { getSuscripcionesDeRoles, borrarSuscripcionDb } from "@/lib/data/push";
import { enviarPush, pushConfigurado } from "@/lib/push/enviar";
import { enviarEmailAlerta, emailConfigurado } from "@/lib/alertas/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A ESCALA: este cron pagina TODOS los pagos del día para reconciliar. Con el tope
// DEFAULT de Vercel (~10-15s) podría matarse a mitad y dejar el log incompleto (se
// vería como "cron caído" por timeout, no por un problema real de plata). 300s es
// el máximo del plan Pro; en Hobby se ignora/clampa (no rompe). El vigilante del
// dinero debe poder terminar su barrido.
export const maxDuration = 300;

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

  try {
  const db = createSupabaseAdmin();
  const r = await reconciliarDia(db);
  if (!r.disponible) {
    // Antes devolvía ok:false en SILENCIO → un vigilante caído se confundía con "todo
    // cuadra". Ahora deja rastro para que se note que la reconciliación no está corriendo.
    reportarError("cron.reconciliacion", new Error("RPC app_reconciliacion_violaciones sin correr (0071)"));
    // Deja una fila en el log para DISTINGUIR "el cron no corrió" (log vacío) de "corrió
    // pero el RPC no está" (esta fila ok:false). Sin esto ambos fallos se ven igual.
    await logReconciliacion(db, {
      ok: false,
      total: 0,
      criticos: 0,
      recaudoLibro: 0,
      origen: "cron",
      detalle: { motivo: "rpc_0071_no_disponible" },
    });
    return Response.json({ ok: false, motivo: "RPC app_reconciliacion_violaciones sin correr (0071)" });
  }

  // Deja registro de la corrida (historial/tendencia en /admin/empalme).
  await logReconciliacion(db, {
    ok: r.ok,
    total: r.hallazgos.length,
    criticos: r.criticos,
    recaudoLibro: r.recaudoLibro,
    origen: "cron",
    detalle: r.porInvariante,
  });

  // Un hallazgo CRÍTICO SIEMPRE deja rastro en Sentry, INDEPENDIENTE del push. El
  // canal push depende de que un admin se haya suscrito en un dispositivo (frágil:
  // hoy 0 suscritos) → sin esto, un sobre-cobro material vivo quedaba solo en el
  // panel, sin que nadie se entere. reportarError es el piso de la alerta.
  if (r.criticos > 0) {
    reportarError(
      "cron.reconciliacion.critico",
      new Error(`${r.criticos} hallazgo(s) crítico(s) de dinero (${r.hallazgos.length} en total)`),
      { criticos: r.criticos, total: r.hallazgos.length, recaudoLibro: r.recaudoLibro },
    );
  }

  // Alerta por EMAIL ante lo CRÍTICO — canal AUTÓNOMO, no depende de que un admin
  // haya instalado la PWA y tocado "activar avisos" en su teléfono (frágil). Es el
  // camino que sí llega solo. Best-effort: si Resend falla o no está configurado,
  // no rompe el cron (el crítico igual quedó en Sentry + el panel + el push).
  if (r.criticos > 0 && emailConfigurado()) {
    let origen = "https://prestaya-blush.vercel.app";
    try {
      origen = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    } catch {
      /* req.url raro → usar el fallback */
    }
    await enviarEmailAlerta({
      asunto: `⚠️ Presta Ya — revisar la plata (${r.criticos} crítico${r.criticos === 1 ? "" : "s"})`,
      cuerpo:
        `La reconciliación de hoy encontró ${r.criticos} hallazgo(s) crítico(s) de dinero ` +
        `(${r.hallazgos.length} en total).\n\n` +
        `Entrá al panel para ver el detalle (qué crédito y de cuánto):\n${origen}/admin/empalme\n\n` +
        `Si algún día NO te llega este mail, es buena señal: significa que la plata cuadró.`,
    });
  }

  // Alerta push SOLO ante lo CRÍTICO: drift del denormalizado (los saldos mienten) o
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
  } catch (e) {
    // El VIGILANTE de la plata deja rastro si él mismo falla (antes solo lo veía
    // onRequestError→Sentry, sin señal si el DSN no estaba). Es la última red.
    reportarError("cron.reconciliacion", e);
    return Response.json({ ok: false, error: "fallo del cron de reconciliación" }, { status: 500 });
  }
}

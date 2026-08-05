// ─────────────────────────────────────────────────────────────────────────
//  Recordatorio .ics — descarga un evento de calendario DIARIO con la cuota,
//  desde hoy hasta el fin del crédito. Sin login ni notificaciones push.
//  Valida el token en el servidor (service_role).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente } from "@/lib/data/prestamos";
import { UYU, parseFecha, toIso } from "@/lib/format";
import { fechaDeCuota } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import { tokenValido } from "@/lib/validacion/esquemas";

/** "YYYY-MM-DD" → "YYYYMMDD" (formato de fecha ICS). */
function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Defensa en el borde: rechazamos tokens con forma inválida antes de tocar la
  // base (mismo guard que las Server Actions de esta ruta).
  if (!tokenValido(token)) return new Response("No encontrado", { status: 404 });
  const db = createSupabaseAdmin();

  const cliente = await getClientePorToken(db, token);
  if (!cliente) return new Response("No encontrado", { status: 404 });

  const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
  if (!prestamo) return new Response("Sin crédito activo", { status: 404 });

  // Rango: desde hoy (o el inicio si aún no empezó) hasta la ÚLTIMA cuota real.
  // `fin` se calcula con el cronograma hábil (Lun–Sáb, salta domingos), igual que
  // el cartón — no sumando días calendario planos (que terminaba ~1 día/semana antes).
  const inicio = parseFecha(prestamo.fecha_inicio);
  const fin = fechaDeCuota(inicio, prestamo.total_dias - 1, prestamo.frecuencia);

  // "Hoy" es el día de URUGUAY (no la medianoche del runtime, que en Vercel es UTC
  // → de tarde-noche en UY arrancaba el recordatorio un día tarde). Mismo criterio
  // que el cartón.
  const hoy = hoyUY();
  const desde = hoy.getTime() > inicio.getTime() ? hoy : inicio;
  // DTSTART debe coincidir con el BYDAY (Lun–Sáb): si arranca un domingo, al lunes.
  if (desde.getDay() === 0) desde.setDate(desde.getDate() + 1);

  const dtStart = icsDate(toIso(desde)) + "T090000";
  const until = icsDate(toIso(fin)) + "T235959";
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const cuota = UYU(prestamo.cuota_diaria);

  // RRULE según la FRECUENCIA del crédito (QA 08-05): a un cliente semanal le
  // sonaba una alarma TODOS los días hábiles por una cuota que vence una vez
  // por semana. Diario = Lun–Sáb (domingo no se cobra); semanal = cada 7 días;
  // quincenal = cada 14; mensual = mensual. Ancla: el DTSTART (primera cuota).
  const frec = (prestamo.frecuencia as string) ?? "diario";
  const rrule =
    frec === "semanal"
      ? `RRULE:FREQ=WEEKLY;UNTIL=${until}`
      : frec === "quincenal"
        ? `RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${until}`
        : frec === "mensual"
          ? `RRULE:FREQ=MONTHLY;UNTIL=${until}`
          : `RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA;UNTIL=${until}`;
  const etiquetaFrec =
    frec === "semanal" ? "semanal" : frec === "quincenal" ? "quincenal" : frec === "mensual" ? "mensual" : "diaria";

  // Evento con una alarma a la hora del evento.
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Presta Ya//Recordatorio//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${prestamo.id}@presta-ya`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    rrule,
    `SUMMARY:Pagar cuota de Presta Ya (${cuota})`,
    `DESCRIPTION:Recordatorio de tu cuota ${etiquetaFrec}. ¡Seguí al día!`,
    "BEGIN:VALARM",
    "TRIGGER:-PT0M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Cuota de hoy",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="recordatorio-presta-ya.ics"',
      "Cache-Control": "no-store",
    },
  });
}

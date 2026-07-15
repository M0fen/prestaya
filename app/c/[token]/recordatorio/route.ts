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

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = hoy.getTime() > inicio.getTime() ? hoy : inicio;
  // DTSTART debe coincidir con el BYDAY (Lun–Sáb): si arranca un domingo, al lunes.
  if (desde.getDay() === 0) desde.setDate(desde.getDate() + 1);

  const dtStart = icsDate(toIso(desde)) + "T090000";
  const until = icsDate(toIso(fin)) + "T235959";
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const cuota = UYU(prestamo.cuota_diaria);

  // Evento diario (FREQ=DAILY) con una alarma a la hora del evento.
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
    // Cobro de LUNES a SÁBADO (el domingo no se cobra): el recordatorio no debe
    // avisar los domingos.
    `RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA;UNTIL=${until}`,
    `SUMMARY:Pagar cuota de Presta Ya (${cuota})`,
    "DESCRIPTION:Recordatorio de tu cuota diaria. ¡Seguí al día!",
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

// Saludo cálido y personal para las "casas" de cada rol (admin/supervisor/cobrador).
// Que la app reconozca a la persona por su nombre y por el momento del día.

/** Saludo según la hora de Uruguay: "Buen día" (hasta mediodía), "Buenas tardes"
 *  (12–19) o "Buenas noches" (19 en adelante). */
export function saludoHora(d: Date = new Date()): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Montevideo",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
  if (h < 12) return "Buen día";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** Primer nombre legible para saludar: saca apellidos, "(apodo)" y ", ciudad".
 *  "Carolina (Carito)" → "Carolina" · "Andrés Duque, Montevideo" → "Andrés". */
export function primerNombre(nombre: string | null | undefined): string {
  const base = (nombre ?? "").split(/[,(]/)[0].trim();
  return base.split(/\s+/)[0] || "";
}

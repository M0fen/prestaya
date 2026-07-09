// ─────────────────────────────────────────────────────────────────────────
//  Validación de INPUT externo con Zod (defensa en el borde).
//  El tipado de TypeScript se borra en runtime: un cliente malicioso puede
//  mandar cualquier cosa a una Server Action o ruta API. Acá rechazamos lo que
//  no cumple ANTES de tocar la base. Empezamos por lo más expuesto (cobrador y
//  cliente por token). Núcleo PURO y testeable.
// ─────────────────────────────────────────────────────────────────────────
import { z } from "zod";

const uuid = z.uuid();
// Fecha: aceptamos cualquier string parseable (ISO con Z u offset). Solo
// rechazamos basura; el valor exacto lo guarda la base.
const fechaISO = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "fecha inválida");
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const opId = z.string().min(1).max(200);

// ── Cobrador (input de la calle, muta dinero) ──────────────────────────────
export const cobroSchema = z.object({
  clienteId: uuid,
  // Crédito específico (si el cliente tiene varios activos). null = el principal.
  prestamoId: uuid.nullish(),
  // Tope defensivo (100M) para descartar montos absurdos/overflow.
  monto: z.number().positive().max(100_000_000).nullish(),
  gpsLat: lat.nullish(),
  gpsLng: lng.nullish(),
  registradoEn: fechaISO.nullish(),
  opId: opId.nullish(),
});

export const noPagoSchema = z.object({
  clienteId: uuid,
  prestamoId: uuid.nullish(),
  motivo: z.enum(["no_estaba", "no_tenia", "se_nego", "reagendado"]),
  gpsLat: lat.nullish(),
  gpsLng: lng.nullish(),
  registradoEn: fechaISO.nullish(),
  opId: opId.nullish(),
});

// ── Cliente por token (vista de solo lectura + reportes/juegos) ────────────
// Forma esperada del token: hex/base de gen_random_bytes o slug de demo.
export const tokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{6,100}$/, "token con forma inválida");

export const reporteFaltaSchema = z.object({
  token: tokenSchema,
  diaCredito: z.number().int().min(1).max(366).nullish(),
  montoReclamado: z.number().positive().max(100_000_000).nullish(),
  comentario: z.string().max(500).nullish(),
});

// ── Rutas API del panel ────────────────────────────────────────────────────
export const busquedaQuery = z.string().trim().min(2).max(80);
export const reporteTipo = z.enum([
  "cartera",
  "caja",
  "mora",
  "comisiones",
  "clientes",
  "pagos",
  "recaudos",
  "informe-cartera",
]);

/** Resultado de validar: datos tipados o rechazo (sin filtrar detalles). */
export type Validado<T> = { ok: true; data: T } | { ok: false };

/** Valida `valor` contra `schema`. Nunca tira: devuelve ok:false si no cumple. */
export function validar<T>(schema: z.ZodType<T>, valor: unknown): Validado<T> {
  const r = schema.safeParse(valor);
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

/** true si el token tiene la forma esperada (barato, antes de tocar la base). */
export function tokenValido(token: unknown): boolean {
  return tokenSchema.safeParse(token).success;
}

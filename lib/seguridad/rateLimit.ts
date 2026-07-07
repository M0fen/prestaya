// ─────────────────────────────────────────────────────────────────────────
//  Rate limiting de rutas sensibles (brecha #1). Protege la factura (Aureo) y
//  contra fuerza bruta (login) y saturación (búsquedas/reportes).
//
//  Estrategia: si están las env de Upstash (UPSTASH_REDIS_REST_URL/TOKEN) se usa
//  Upstash Ratelimit (distribuido, ideal para Vercel). Si no, cae a un limitador
//  EN MEMORIA por instancia (mejor que nada; funciona ya, sin infra). Si Upstash
//  falla en runtime, NO se rompe la app: cae a memoria. Núcleo del contador de
//  memoria = PURO y testeable.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";

export interface ConfigBucket {
  limite: number;
  ventanaSeg: number;
}

// Números confirmados con Carlos.
export const BUCKETS = {
  login: { limite: 5, ventanaSeg: 60 }, // por IP (fuerza bruta)
  asesor: { limite: 20, ventanaSeg: 60 }, // por usuario (cuesta $)
  buscar: { limite: 30, ventanaSeg: 60 }, // por usuario
  reportes: { limite: 10, ventanaSeg: 60 }, // por usuario
} satisfies Record<string, ConfigBucket>;

export type Bucket = keyof typeof BUCKETS;

/**
 * Limitador EN MEMORIA (ventana fija). Puro y determinista (se le puede pasar
 * `ahora`), por eso es testeable. Devuelve true si la petición se permite.
 */
export class LimitadorMemoria {
  private m = new Map<string, { conteo: number; hasta: number }>();

  permitir(clave: string, limite: number, ventanaSeg: number, ahora: number = Date.now()): boolean {
    const e = this.m.get(clave);
    if (!e || ahora >= e.hasta) {
      this.m.set(clave, { conteo: 1, hasta: ahora + ventanaSeg * 1000 });
      return true;
    }
    if (e.conteo >= limite) return false;
    e.conteo += 1;
    return true;
  }
}

const memoria = new LimitadorMemoria();

function upstashDisponible(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// Un Ratelimit de Upstash por bucket (se crean una sola vez).
type UpstashRL = { limit: (id: string) => Promise<{ success: boolean }> };
const upstashPorBucket = new Map<Bucket, UpstashRL>();

async function permitirUpstash(bucket: Bucket, id: string): Promise<boolean> {
  let rl = upstashPorBucket.get(bucket);
  if (!rl) {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const cfg = BUCKETS[bucket];
    rl = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(cfg.limite, `${cfg.ventanaSeg} s`),
      prefix: `rl:${bucket}`,
      analytics: false,
    }) as unknown as UpstashRL;
    upstashPorBucket.set(bucket, rl);
  }
  const r = await rl.limit(id);
  return r.success;
}

/**
 * ¿Se permite esta petición? `id` = IP (login) o id de usuario (resto).
 * Nunca tira: ante cualquier fallo de Upstash, cae al limitador en memoria.
 */
export async function permitir(bucket: Bucket, id: string): Promise<boolean> {
  const cfg = BUCKETS[bucket];
  const clave = `${bucket}:${id}`;
  if (upstashDisponible()) {
    try {
      return await permitirUpstash(bucket, id);
    } catch {
      // Upstash caído/mal configurado → no bloquear la app; usar memoria.
    }
  }
  return memoria.permitir(clave, cfg.limite, cfg.ventanaSeg);
}

/** IP del cliente a partir de los headers (x-forwarded-for). "desconocida" si no hay. */
export function ipDesdeHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "desconocida";
}

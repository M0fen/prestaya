// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — SERIES TEMPORALES para los gráficos del dashboard.
//  Deriva de datos REALES (tabla `pagos`): recaudación por día de los últimos
//  N días, agrupada por el día calendario de Uruguay (no por UTC). Barato: una
//  sola query + agregación en JS. Corre como el usuario logueado (RLS).
// ─────────────────────────────────────────────────────────────────────────
import { traerTodo } from "./paginado";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyUY, inicioDiaUYIso } from "@/lib/fecha";
import { toIso, diasSemana } from "@/lib/format";

const DIA_MS = 86_400_000;
const TZ = "America/Montevideo";

/** Un día de la serie de recaudo. */
export interface DiaSerie {
  /** Fecha del día en formato "YYYY-MM-DD" (día calendario de Uruguay). */
  iso: string;
  /** Etiqueta corta para el eje, p. ej. "mié 2". */
  etiqueta: string;
  diaMes: number;
  recaudado: number;
  cobros: number;
  esHoy: boolean;
}

export interface SerieRecaudo {
  dias: DiaSerie[];
  /** Total recaudado en la ventana. */
  total: number;
  /** Promedio diario simple (total / N). */
  promedio: number;
  /** Máximo diario (para escalar los gráficos). */
  maximo: number;
  /** Recaudado hoy (último día de la serie). */
  hoy: number;
  /** Tendencia: media de los últimos 3 días vs los 3 previos (−1..+1 aprox). */
  tendencia: number;
}

/** Convierte un ISO instantáneo al día calendario de Uruguay ("YYYY-MM-DD"). */
function diaUYde(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Recaudación diaria de los últimos `dias` días (incluye hoy). Agrupa por el
 * día de Uruguay para que un cobro de las 23:30 no “salte” al día siguiente.
 */
export async function getSerieRecaudo(
  db: SupabaseClient,
  hoy: Date = new Date(),
  dias = 14,
): Promise<SerieRecaudo> {
  const N = Math.max(2, Math.min(60, Math.round(dias)));
  const base = hoyUY(hoy); // medianoche local con la fecha Y/M/D de Uruguay
  const desde = new Date(base.getTime() - (N - 1) * DIA_MS);
  const desdeIso = inicioDiaUYIso(desde);

  // Buckets vacíos (uno por día), en orden cronológico.
  const buckets = new Map<string, DiaSerie>();
  const hoyIso = toIso(base);
  for (let i = N - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * DIA_MS);
    const iso = toIso(d);
    buckets.set(iso, {
      iso,
      etiqueta: `${diasSemana[d.getDay()].slice(0, 3)} ${d.getDate()}`,
      diaMes: d.getDate(),
      recaudado: 0,
      cobros: 0,
      esHoy: iso === hoyIso,
    });
  }

  // A ESCALA: la suma por día la hace la base (RPC 0040), no se traen ~16k pagos.
  const { data, error } = await db.rpc("app_serie_recaudo", { dias: N });
  if (error) throw error;
  for (const r of (data ?? []) as { dia: string; recaudado: number; cobros: number }[]) {
    const b = buckets.get(r.dia); // dia = "YYYY-MM-DD" de Uruguay
    if (!b) continue;
    b.recaudado += Number(r.recaudado);
    b.cobros += Number(r.cobros);
  }

  const arr = [...buckets.values()];
  const total = arr.reduce((s, d) => s + d.recaudado, 0);
  const maximo = arr.reduce((m, d) => Math.max(m, d.recaudado), 0);
  const hoyVal = arr[arr.length - 1]?.recaudado ?? 0;

  // Tendencia: últimos 3 días vs 3 previos, normalizada.
  const ult3 = arr.slice(-3).reduce((s, d) => s + d.recaudado, 0);
  const prev3 = arr.slice(-6, -3).reduce((s, d) => s + d.recaudado, 0);
  const tendencia = prev3 > 0 ? (ult3 - prev3) / prev3 : ult3 > 0 ? 1 : 0;

  return {
    dias: arr,
    total,
    promedio: Math.round(total / N),
    maximo,
    hoy: hoyVal,
    tendencia,
  };
}

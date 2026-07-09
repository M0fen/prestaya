// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — "NO PAGO SOSPECHOSO" de HOY (admin). Cruza las visitas
//  marcadas "no pago" del día con la FIABILIDAD del cliente (derivada de su
//  cartón): si un cliente muy cumplidor aparece como "no pagó", es candidato a
//  cobré-y-no-registré. Corre como gestor; el supervisor ve solo su zona.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { calcularEstadosCarton } from "@/lib/cartones";
import { clasificarNoPago, type NivelNoPago } from "@/lib/noPagoSospechoso";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { alcanceDelActor, type Alcance } from "./alcance";
import type { Prestamo } from "@/types/db";

export interface NoPagoSospechosoFila {
  clienteId: string;
  clienteNombre: string;
  cobradorNombre: string | null;
  nivel: NivelNoPago; // "revisar" | "sospechoso"
  cumplimientoPct: number; // 0..100
  cuotasVencidas: number;
  cuotasPagadas: number;
  motivo: string;
}

/**
 * No-pagos sospechosos de hoy. Solo mira visitas con resultado "no_pago" (no
 * "no estaba" ni "reagendado", que tienen otra lectura) sobre créditos activos.
 */
export async function getNoPagosSospechososHoy(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcancePre?: Alcance,
): Promise<NoPagoSospechosoFila[]> {
  const alcance = alcancePre ?? (await alcanceDelActor());
  const desde = inicioDiaUYIso(hoy);
  const hoyCal = hoyUY(hoy);

  // Visitas "no pago" de hoy (bajo RLS ya vienen acotadas; igual filtramos por
  // el cobrador del alcance más abajo, al cruzar con la cartera scopeada).
  const { data: visitas, error } = await db
    .from("visitas")
    .select("prestamo_id, cobrador_id, resultado, registrado_en")
    .eq("resultado", "no_pago")
    .gte("registrado_en", desde);
  if (error) throw error;
  if (!visitas || visitas.length === 0) return [];

  // Cartera activa (ya acotada a la zona si es supervisor) → fiabilidad por préstamo.
  const activos = await getActivosConPagos(db, alcance);
  const porPrestamo = new Map<string, (typeof activos)[number]>();
  for (const a of activos) porPrestamo.set(a.id, a);

  const filas: NoPagoSospechosoFila[] = [];
  const vistos = new Set<string>(); // dedup por préstamo (una visita ya alcanza)
  for (const v of visitas) {
    const prestamoId = v.prestamo_id as string;
    if (vistos.has(prestamoId)) continue;
    const a = porPrestamo.get(prestamoId);
    if (!a) continue; // crédito no activo / fuera de la zona del gestor
    vistos.add(prestamoId);

    const carton = calcularEstadosCarton(
      {
        cuota_diaria: Number(a.cuota_diaria),
        total_dias: Number(a.total_dias),
        frecuencia: a.frecuencia ?? "diario",
        fecha_inicio: a.fecha_inicio,
      } as Prestamo,
      pagosDeActivo(a),
      hoyCal,
    );
    // Cuotas ya vencidas (todo lo que no es futuro) y cuántas quedaron pagadas.
    const cuotasVencidas = carton.dias.filter((d) => d.estado !== "futuro").length;
    const cuotasPagadas = carton.dias.filter((d) => d.estado === "pagado").length;

    const r = clasificarNoPago({ cuotasVencidas, cuotasPagadas }, true);
    if (r.nivel === "normal") continue;
    filas.push({
      clienteId: a.cliente_id,
      clienteNombre: a.cliente_nombre ?? "Cliente",
      cobradorNombre: a.cobrador_nombre ?? null,
      nivel: r.nivel,
      cumplimientoPct: Math.round(r.tasaCumplimiento * 100),
      cuotasVencidas,
      cuotasPagadas,
      motivo: r.motivo,
    });
  }

  // Más sospechoso (mayor cumplimiento) arriba.
  filas.sort((x, y) => {
    const orden = { sospechoso: 0, revisar: 1, normal: 2 } as const;
    return orden[x.nivel] - orden[y.nivel] || y.cumplimientoPct - x.cumplimientoPct;
  });
  return filas;
}

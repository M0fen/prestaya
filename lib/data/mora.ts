// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ALERTA TEMPRANA de mora (admin/supervisor).
//  Corre la alerta (lib/alerta.ts) sobre TODA la cartera activa y devuelve los
//  clientes que se están yendo a mora, del más urgente al menos, + un resumen.
//  Trae los pagos en un solo batch (sin N+1). Corre como gestor (RLS ve todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import type { NivelRiesgo, ResultadoAlerta } from "@/types/alerta";
import { calcularAlertaMora } from "@/lib/alerta";
import { plazoVencido, saldoCredito } from "@/lib/cartones";
import { calcularRecargoMora, type ConfigMora } from "@/lib/moraCargo";
import { getConfigMora } from "./moraConfig";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { hoyUY } from "@/lib/fecha";

export interface ClienteEnRiesgo {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  cobradorId: string | null;
  cobradorNombre: string | null;
  alerta: ResultadoAlerta;
  /** Recargo por mora sugerido según la política vigente (0 si está en off). */
  recargoMora: number;
}

export interface TableroMora {
  resumen: {
    /** Créditos activos evaluados. */
    activos: number;
    critico: number;
    alto: number;
    medio: number;
    sano: number;
    /** $ vencido total de los créditos con alerta (medio/alto/crítico). */
    deudaEnRiesgo: number;
    /** Recargo por mora total sugerido (suma de la cartera en riesgo). */
    recargoTotal: number;
    /** Créditos activos con el PLAZO ya vencido e impagos (cartera vencida /
     *  deuda de castigo). Se cuentan aparte: no son alerta temprana. */
    vencidos: number;
    carteraVencida: number;
  };
  /** Política de mora vigente (para mostrarla y editarla). */
  config: ConfigMora;
  enRiesgo: ClienteEnRiesgo[];
}

const num = (v: unknown): number => Number(v);

/**
 * Tablero de mora: evalúa cada crédito activo y lista los que necesitan
 * atención (nivel ≠ "sano"), ordenados por riesgo descendente.
 */
export async function getTableroMora(
  db: SupabaseClient,
  hoy: Date = new Date(),
  activosPre?: import("./activos").ActivoConPagos[],
): Promise<TableroMora> {
  const hoyCal = hoyUY(hoy);
  const config = await getConfigMora(db);

  // A ESCALA: una sola RPC trae los créditos activos con sus pagos AGRUPADOS
  // (≈2.661 filas, no ≈20k) + nombre de cliente/cobrador. El cartón/alerta se
  // sigue calculando en TS (tested, autoritativa).
  const activos = activosPre ?? (await getActivosConPagos(db));

  const vacio: TableroMora = {
    resumen: { activos: 0, critico: 0, alto: 0, medio: 0, sano: 0, deudaEnRiesgo: 0, recargoTotal: 0, vencidos: 0, carteraVencida: 0 },
    config,
    enRiesgo: [],
  };
  if (activos.length === 0) return vacio;

  const resumen = { activos: 0, critico: 0, alto: 0, medio: 0, sano: 0, deudaEnRiesgo: 0, recargoTotal: 0, vencidos: 0, carteraVencida: 0 };
  const enRiesgo: ClienteEnRiesgo[] = [];

  for (const p of activos) {
    const cond = {
      cuota_diaria: num(p.cuota_diaria),
      total_dias: num(p.total_dias),
      frecuencia: p.frecuencia ?? "diario",
      fecha_inicio: p.fecha_inicio,
    };
    resumen.activos++;

    // Plazo YA vencido → CARTERA VENCIDA (deuda de castigo), no alerta temprana:
    // no infla el riesgo ni la "deuda en riesgo". Coherente con la mora del
    // dashboard (metricas.ts): un crédito muerto no es mora del día.
    if (plazoVencido(cond, hoyCal)) {
      resumen.vencidos++;
      resumen.carteraVencida += saldoCredito(num(p.cuota_diaria), num(p.total_dias), num(p.pagado ?? 0));
      continue;
    }

    const alerta = calcularAlertaMora({ prestamo: cond, pagos: pagosDeActivo(p), hoy: hoyCal });
    resumen[alerta.nivel]++;

    if (alerta.nivel === "sano") continue;

    // Deuda VENCIDA real (sin la cuota de hoy) para el total y el recargo — evita
    // inflar la mora y cobrar recargo sobre algo que aún no venció (anti-usura).
    resumen.deudaEnRiesgo += alerta.senales.montoVencido;
    // Recargo por mora sugerido según la política (0 si está en off).
    const recargoMora = calcularRecargoMora(
      alerta.senales.montoVencido,
      alerta.senales.atrasosTotales,
      config,
    );
    resumen.recargoTotal += recargoMora;
    enRiesgo.push({
      clienteId: p.cliente_id,
      nombre: p.cliente_nombre ?? "Cliente",
      telefono: p.cliente_telefono ?? null,
      direccion: p.cliente_direccion ?? null,
      cobradorId: p.cobrador_id ?? null,
      cobradorNombre: p.cobrador_nombre ?? null,
      alerta,
      recargoMora,
    });
  }

  const orden: Record<NivelRiesgo, number> = { critico: 0, alto: 1, medio: 2, sano: 3 };
  enRiesgo.sort(
    (a, b) =>
      orden[a.alerta.nivel] - orden[b.alerta.nivel] || b.alerta.riesgo - a.alerta.riesgo,
  );

  return { resumen, config, enRiesgo };
}

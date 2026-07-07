// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CARTERA para exportar (admin/supervisor).
//  Lista TODOS los créditos activos con su saldo derivado del cartón (fuente
//  canónica: mismo cálculo que ve el cliente). Carga en batch (sin N+1),
//  espejando el patrón de lib/data/mora.ts. Corre como gestor (RLS ve todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pago, Prestamo } from "@/types/db";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";

const N = (v: unknown): number => Number(v);

export interface FilaCartera {
  cliente: string;
  documento: string;
  telefono: string;
  cobrador: string;
  calificacion: string;
  frecuencia: string;
  inicio: string;
  montoPrestado: number;
  cuota: number;
  totalDias: number;
  totalAPagar: number;
  pagado: number;
  saldo: number;
  progresoPct: number;
  diasAtrasados: number;
}

/** Todos los créditos activos con su saldo (para exportar la cartera). */
export async function getCarteraExport(
  db: SupabaseClient,
  hoy: Date = new Date(),
): Promise<FilaCartera[]> {
  const hoyCal = hoyUY(hoy);

  const { data: presRaw, error } = await db
    .from("prestamos")
    .select(
      "id, cliente_id, cobrador_id, cuota_diaria, total_dias, frecuencia, fecha_inicio, monto_prestado",
    )
    .eq("estado", "activo");
  if (error) throw error;

  const prestamos = (presRaw ?? []) as unknown as (Prestamo & { monto_prestado: number })[];
  if (prestamos.length === 0) return [];

  const clienteIds = [...new Set(prestamos.map((p) => p.cliente_id))];
  const prestamoIds = prestamos.map((p) => p.id);
  const cobradorIds = [
    ...new Set(prestamos.map((p) => p.cobrador_id).filter((x): x is string => !!x)),
  ];

  const [cliRes, pagRes, cobRes] = await Promise.all([
    db.from("clientes").select("id, nombre, documento, telefono, calificacion").in("id", clienteIds),
    db
      .from("pagos")
      .select("prestamo_id, dia_credito, monto")
      .eq("anulado", false)
      .in("prestamo_id", prestamoIds),
    cobradorIds.length
      ? db.from("usuarios").select("id, nombre").in("id", cobradorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cliRes.error) throw cliRes.error;
  if (pagRes.error) throw pagRes.error;
  if (cobRes.error) throw cobRes.error;

  const cliente = new Map<
    string,
    { nombre: string; documento: string; telefono: string; calificacion: string }
  >();
  for (const c of cliRes.data ?? [])
    cliente.set(c.id as string, {
      nombre: (c.nombre as string) ?? "Cliente",
      documento: (c.documento as string | null) ?? "",
      telefono: (c.telefono as string | null) ?? "",
      calificacion: (c.calificacion as string | null) ?? "",
    });

  const cobrador = new Map<string, string>();
  for (const c of cobRes.data ?? []) cobrador.set(c.id as string, c.nombre as string);

  const pagosDe = new Map<string, Pick<Pago, "dia_credito" | "monto">[]>();
  for (const p of pagRes.data ?? []) {
    const arr = pagosDe.get(p.prestamo_id as string) ?? [];
    arr.push({ dia_credito: N(p.dia_credito), monto: N(p.monto) });
    pagosDe.set(p.prestamo_id as string, arr);
  }

  const filas: FilaCartera[] = prestamos.map((p) => {
    const carton = calcularEstadosCarton(
      {
        cuota_diaria: N(p.cuota_diaria),
        total_dias: N(p.total_dias),
        frecuencia: p.frecuencia ?? "diario",
        fecha_inicio: p.fecha_inicio,
      },
      pagosDe.get(p.id) ?? [],
      hoyCal,
    );
    const cli = cliente.get(p.cliente_id);
    return {
      cliente: cli?.nombre ?? "Cliente",
      documento: cli?.documento ?? "",
      telefono: cli?.telefono ?? "",
      cobrador: p.cobrador_id ? (cobrador.get(p.cobrador_id) ?? "") : "",
      calificacion: cli?.calificacion ?? "",
      frecuencia: p.frecuencia ?? "diario",
      inicio: p.fecha_inicio,
      montoPrestado: Math.round(N(p.monto_prestado)),
      cuota: Math.round(N(p.cuota_diaria)),
      totalDias: N(p.total_dias),
      totalAPagar: carton.totalAPagar,
      pagado: carton.totalPagado,
      saldo: carton.falta,
      progresoPct: carton.progresoPct,
      diasAtrasados: carton.dias.filter((d) => d.estado === "atrasado").length,
    };
  });

  filas.sort((a, b) => a.cliente.localeCompare(b.cliente, "es"));
  return filas;
}

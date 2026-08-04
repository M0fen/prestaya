// ─────────────────────────────────────────────────────────────────────────
//  Candidatos para colocar capital DESDE LA CALLE (08-05).
//
//  Dos listas, cada una con su regla:
//   · RENOVAR — clientes de la ruta cuyo crédito activo ya está SALDADO. La
//     verdad la da el cartón (mismo cálculo que ve el cliente), no un campo
//     guardado: `falta < 1` es el mismo umbral que usa el gate del servidor,
//     porque las cuotas fraccionarias heredadas de Disapp (351,04 × 24) dejan
//     residuos de centavos que son incobrables.
//   · NUEVA VENTA — clientes de la ruta SIN crédito activo pero CON historial
//     (el primer crédito de alguien lo da la oficina).
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstadosCarton } from "@/lib/cartones";
import { topeAumentoPct, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { getPagosDePrestamo } from "./pagos";
import { traerTodo } from "./paginado";
import type { Cliente, Prestamo } from "@/types/db";

export interface CandidatoColocar {
  clienteId: string;
  nombre: string;
  documento: string | null;
  /** Solo en "renovar": el crédito saldado que se va a repetir. */
  prestamoId?: string;
  /** Términos que se repiten (renovar) o del último crédito (venta). */
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: string;
  /** Cuánto le falta pagar (renovar: < 1 por definición). */
  falta?: number;
  /** Hasta cuánto puede colocar el cobrador SIN pedir permiso. Se calcula con
   *  `topeAumentoPct` — la MISMA función que después valida el alta — así la
   *  pantalla nunca ofrece un monto que el servidor va a rechazar. */
  techo: number;
}

/** Techo auto-aprobable para un monto anterior dado (nunca por encima del CAP). */
function techoDe(montoAnterior: number): number {
  const pct = topeAumentoPct(montoAnterior);
  return Math.min(RENOVACION_CAP_TOTAL, Math.round(montoAnterior * (1 + pct / 100)));
}

/** Clientes de MI ruta que ya terminaron de pagar: listos para repetir. */
export async function getCandidatosRenovar(db: SupabaseClient): Promise<CandidatoColocar[]> {
  const { data: asig } = await db.from("asignaciones").select("cliente_id").eq("activo", true);
  const ids = [...new Set((asig ?? []).map((a) => a.cliente_id as string))];
  if (ids.length === 0) return [];

  const activos = await traerTodo<Prestamo>((d, h) =>
    db
      .from("prestamos")
      .select("*")
      .eq("estado", "activo")
      .in("cliente_id", ids)
      .order("id", { ascending: true })
      .range(d, h),
  );
  if (activos.length === 0) return [];

  const { data: cls } = await db
    .from("clientes")
    .select("id, nombre, documento, activo")
    .in("id", [...new Set(activos.map((p) => p.cliente_id))]);
  const cliDe = new Map((cls ?? []).map((c) => [c.id as string, c as unknown as Cliente]));

  const hoy = hoyUY();
  // Saldo por crédito → y por CLIENTE: un cliente entra a "Renovar" solo si
  // TODOS sus créditos activos están saldados (mismo gate que el servidor,
  // auditoría 08-05). Si uno está saldado pero otro debe, renovarle el primero
  // sería darle capital nuevo con deuda viva al lado.
  const faltaDe = new Map<string, number>();
  const clienteConDeuda = new Set<string>();
  for (const p of activos) {
    const pagos = await getPagosDePrestamo(db, p.id);
    const carton = calcularEstadosCarton(p, pagos, hoy);
    faltaDe.set(p.id, carton.falta);
    if (carton.falta >= 1) clienteConDeuda.add(p.cliente_id);
  }
  const out: CandidatoColocar[] = [];
  for (const p of activos) {
    const cli = cliDe.get(p.cliente_id);
    if (!cli || !cli.activo) continue;
    if (clienteConDeuda.has(p.cliente_id)) continue;
    const carton = { falta: faltaDe.get(p.id) ?? 0 };
    // Mismo umbral que el gate del servidor: un residuo de centavos no traba.
    if (carton.falta >= 1) continue;
    out.push({
      clienteId: p.cliente_id,
      nombre: cli.nombre,
      documento: cli.documento ?? null,
      prestamoId: p.id,
      monto: Math.round(Number(p.monto_prestado) || 0),
      cuota: Math.round(Number(p.cuota_diaria) || 0),
      totalDias: Number(p.total_dias) || 0,
      frecuencia: (p.frecuencia as string) ?? "diario",
      falta: Math.max(0, Math.round(carton.falta)),
      techo: techoDe(Math.round(Number(p.monto_prestado) || 0)),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Clientes de MI ruta SIN crédito activo y CON historial: listos para vender. */
export async function getCandidatosVenta(db: SupabaseClient): Promise<CandidatoColocar[]> {
  const { data: asig } = await db.from("asignaciones").select("cliente_id").eq("activo", true);
  const ids = [...new Set((asig ?? []).map((a) => a.cliente_id as string))];
  if (ids.length === 0) return [];

  const todos = await traerTodo<Prestamo>((d, h) =>
    db
      .from("prestamos")
      .select("*")
      .in("cliente_id", ids)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const conActivo = new Set(todos.filter((p) => p.estado === "activo").map((p) => p.cliente_id));

  // Último crédito por cliente (de ahí salen los términos sugeridos y la tasa).
  const ultimo = new Map<string, Prestamo>();
  for (const p of todos) {
    const prev = ultimo.get(p.cliente_id);
    if (!prev || String(p.fecha_inicio) > String(prev.fecha_inicio)) ultimo.set(p.cliente_id, p);
  }

  const elegibles = [...ultimo.entries()].filter(([cid]) => !conActivo.has(cid));
  if (elegibles.length === 0) return [];

  const { data: cls } = await db
    .from("clientes")
    .select("id, nombre, documento, activo")
    .in("id", elegibles.map(([cid]) => cid));
  const cliDe = new Map((cls ?? []).map((c) => [c.id as string, c as unknown as Cliente]));

  return elegibles
    .flatMap(([cid, p]) => {
      const cli = cliDe.get(cid);
      if (!cli || !cli.activo) return [];
      const monto = Math.round(Number(p.monto_prestado) || 0);
      const cuota = Math.round(Number(p.cuota_diaria) || 0);
      const totalDias = Number(p.total_dias) || 0;
      // Sin historial usable, el alta la hace la oficina: no se ofrece acá.
      if (!(monto > 0 && cuota > 0 && totalDias > 0)) return [];
      return [
        {
          clienteId: cid,
          nombre: cli.nombre,
          documento: cli.documento ?? null,
          monto,
          cuota,
          totalDias,
          frecuencia: (p.frecuencia as string) ?? "diario",
          techo: techoDe(monto),
        },
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RENOVACIÓN pre-aprobada (admin/supervisor).
//  Detecta clientes con el crédito por completar/completado y les corre el
//  SCORING (ya construido) para sugerir acción y monto del próximo crédito.
//  Enchufa el momento de mayor conversión con la decisión de plata.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, Pago, Prestamo } from "@/types/db";
import type { ResultadoScore } from "@/types/scoring";
import { getClientesAsignados } from "./clientes";
import { getPagosDePrestamo } from "./pagos";
import { getPrestamoPorId } from "./prestamos";
import { getHistorialCrediticio } from "./scoring";
import { calcularEstadosCarton } from "@/lib/cartones";
import { calcularScore } from "@/lib/scoring";
import { calcularCuotaRenovacion } from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";

/** Datos del crédito actual, base para calcular los términos del próximo. */
export interface PrestamoAnterior {
  id: string;
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: import("@/types/db").FrecuenciaPrestamo;
  cobradorId: string | null;
}

export interface CandidatoRenovacion {
  cliente: Cliente;
  progresoPct: number;
  completo: boolean;
  cuotasFaltantes: number;
  score: ResultadoScore;
  prestamoAnterior: PrestamoAnterior;
  /** Marcado como moroso (aviso al renovar). false si falta la 0027. */
  moroso: boolean;
}

/**
 * Candidatos a renovación: clientes con préstamo activo cuyo avance supera
 * `umbral` (por completar) o que ya completaron. Ordenados por el más avanzado.
 */
export async function getCandidatosRenovacion(
  db: SupabaseClient,
  hoy: Date = new Date(),
  umbral = 0.75,
): Promise<CandidatoRenovacion[]> {
  const clientes = await getClientesAsignados(db);
  if (clientes.length === 0) return [];

  const { data: presRaw, error } = await db
    .from("prestamos")
    .select("id, cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, frecuencia, fecha_inicio")
    .eq("estado", "activo");
  if (error) throw error;

  const prestamoDe = new Map<string, Prestamo>();
  for (const p of presRaw ?? [])
    prestamoDe.set(p.cliente_id as string, {
      ...(p as Record<string, unknown>),
      monto_prestado: Number(p.monto_prestado),
      cuota_diaria: Number(p.cuota_diaria),
      total_dias: Number(p.total_dias),
      frecuencia: (p.frecuencia as Prestamo["frecuencia"]) ?? "diario",
      estado: "activo",
    } as unknown as Prestamo);

  const candidatos: CandidatoRenovacion[] = [];
  const hoyCal = hoyUY(hoy);

  for (const cliente of clientes) {
    const prestamo = prestamoDe.get(cliente.id);
    if (!prestamo) continue;

    const pagos: Pago[] = await getPagosDePrestamo(db, prestamo.id);
    const r = calcularEstadosCarton(prestamo, pagos, hoyCal);
    const progreso = r.progresoPct / 100;
    if (progreso < umbral) continue; // aún lejos de renovar

    const cuotasCubiertas = r.dias.filter((d) => d.estado === "pagado").length;
    const historial = await getHistorialCrediticio(db, cliente.id);
    const score = calcularScore({ ...historial, hoy: hoyCal });

    candidatos.push({
      cliente,
      progresoPct: r.progresoPct,
      completo: r.falta === 0,
      cuotasFaltantes: Math.max(0, prestamo.total_dias - cuotasCubiertas),
      score,
      moroso: false,
      prestamoAnterior: {
        id: prestamo.id,
        monto: prestamo.monto_prestado,
        cuota: prestamo.cuota_diaria,
        totalDias: prestamo.total_dias,
        frecuencia: prestamo.frecuencia,
        cobradorId: prestamo.cobrador_id,
      },
    });
  }

  // Marca de moroso de cada candidato (aviso al renovar). Degrada si falta 0027.
  const ids = candidatos.map((c) => c.cliente.id);
  if (ids.length > 0) {
    const { data } = await db.from("clientes").select("id, moroso").in("id", ids);
    const marca = new Map((data ?? []).map((r) => [r.id as string, Boolean(r.moroso)]));
    for (const c of candidatos) c.moroso = marca.get(c.cliente.id) ?? false;
  }

  return candidatos.sort((a, b) => b.progresoPct - a.progresoPct);
}

// ── ALTA REAL del crédito de renovación (escribe dinero) ───────────────────

/** Términos que confirma el gestor para el nuevo crédito. */
export interface AltaRenovacion {
  clienteId: string;
  prestamoAnteriorId: string;
  /** Capital del nuevo crédito (UYU). */
  monto: number;
  /** Cantidad de cuotas del nuevo crédito. */
  totalDias: number;
  /** Frecuencia de las cuotas del nuevo crédito. */
  frecuencia: import("@/types/db").FrecuenciaPrestamo;
  /** usuarios.id del gestor que da el alta (auditoría). */
  creadoPor: string | null;
}

export type ResultadoAlta =
  | { ok: true; prestamoId: string; cuota: number }
  | { ok: false; error: string };

/**
 * Crea el crédito de renovación de forma segura:
 *  1. valida que el crédito anterior exista, sea del cliente, esté ACTIVO y
 *     SALDADO (falta === 0) — no se renueva por encima de un saldo pendiente;
 *  2. finaliza el crédito anterior (queda un solo activo por cliente, regla BD);
 *  3. inserta el nuevo crédito arrastrando la tasa del anterior (la cuota se
 *     calcula en el servidor: el cliente no puede alterar el dinero).
 * Si el insert falla, revierte el finalizado (compensación) para no dejar al
 * cliente sin crédito activo. Corre con la sesión del gestor (RLS lo exige).
 */
export async function crearRenovacion(
  db: SupabaseClient,
  input: AltaRenovacion,
  hoy: Date = new Date(),
): Promise<ResultadoAlta> {
  const { clienteId, prestamoAnteriorId, monto, totalDias, frecuencia, creadoPor } = input;
  const FREQ = ["diario", "semanal", "quincenal", "mensual"];

  // 1. Validaciones (antes de tocar nada).
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  if (!(Number.isInteger(totalDias) && totalDias > 0))
    return { ok: false, error: "La cantidad de cuotas debe ser un entero mayor a 0." };
  if (!FREQ.includes(frecuencia))
    return { ok: false, error: "Frecuencia inválida." };

  const ant = await getPrestamoPorId(db, prestamoAnteriorId);
  if (!ant || ant.cliente_id !== clienteId || ant.estado !== "activo")
    return { ok: false, error: "El crédito anterior no está activo." };

  const pagos = await getPagosDePrestamo(db, ant.id);
  const r = calcularEstadosCarton(ant, pagos, hoyUY(hoy));
  if (r.falta > 0)
    return { ok: false, error: "El crédito actual todavía no está saldado." };

  // La cuota arrastra la tasa del crédito anterior (mismo cálculo que el form).
  const cuota = calcularCuotaRenovacion(
    { monto: ant.monto_prestado, cuota: ant.cuota_diaria, totalDias: ant.total_dias },
    monto,
    totalDias,
  );
  if (!(cuota > 0))
    return { ok: false, error: "La cuota calculada es inválida (revisar monto/días)." };

  // 2. Finalizar el anterior (solo si sigue activo: evita doble renovación).
  const fin = await db
    .from("prestamos")
    .update({ estado: "finalizado", finalizado_en: new Date().toISOString() })
    .eq("id", ant.id)
    .eq("estado", "activo")
    .select("id");
  if (fin.error) return { ok: false, error: "No se pudo finalizar el crédito anterior." };
  if (!fin.data || fin.data.length === 0)
    return { ok: false, error: "El crédito anterior ya fue renovado por otra persona." };

  // 3. Insertar el nuevo crédito activo.
  const alta = await db
    .from("prestamos")
    .insert({
      cliente_id: clienteId,
      cobrador_id: ant.cobrador_id,
      monto_prestado: monto,
      cuota_diaria: cuota,
      total_dias: totalDias,
      frecuencia,
      fecha_inicio: toIso(hoyUY(hoy)),
      estado: "activo",
      creado_por: creadoPor,
    })
    .select("id")
    .single();

  if (alta.error || !alta.data) {
    // Compensación: reactivar el anterior para no dejar al cliente sin crédito.
    await db
      .from("prestamos")
      .update({ estado: "activo", finalizado_en: null })
      .eq("id", ant.id);
    return { ok: false, error: "No se pudo crear el crédito; se revirtió el cambio." };
  }

  return { ok: true, prestamoId: alta.data.id as string, cuota };
}

// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ESTRELLAS. Los fragmentos se DERIVAN del conteo de pagos NO
//  anulados; solo se persisten las redenciones (canjes). Resiliente: si 0020 no
//  corrió, las redenciones se tratan como vacías (el saldo se sigue mostrando).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstrellas, type RedencionMin, type SaldoEstrellas, type EstadoRedencion } from "@/lib/estrellas";
import { tablaFaltante } from "@/lib/data/errores";

/** Cuenta los pagos VIGENTES (no anulados) de un cliente = fragmentos ganados. */
export async function contarPagosVigentesCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<number> {
  const { data: prestamos, error: e1 } = await db
    .from("prestamos")
    .select("id")
    .eq("cliente_id", clienteId);
  if (e1) throw e1;
  const ids = (prestamos ?? []).map((p) => (p as { id: string }).id);
  if (ids.length === 0) return 0;

  const { count, error: e2 } = await db
    .from("pagos")
    .select("*", { count: "exact", head: true })
    .in("prestamo_id", ids)
    .eq("anulado", false);
  if (e2) throw e2;
  return count ?? 0;
}

/** Redenciones de un cliente (vacío si 0020 no corrió). */
export async function getRedencionesCliente(
  db: SupabaseClient,
  clienteId: string,
): Promise<RedencionMin[]> {
  try {
    const { data, error } = await db
      .from("estrellas_redenciones")
      .select("estrellas, estado, ciclo")
      .eq("cliente_id", clienteId);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      estrellas: Number((r as { estrellas: number }).estrellas),
      estado: (r as { estado: EstadoRedencion }).estado,
      ciclo: (r as { ciclo: string }).ciclo,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Saldo completo de estrellas de un cliente para el ciclo actual. */
export async function getSaldoEstrellas(
  db: SupabaseClient,
  clienteId: string,
  cicloActual: string,
): Promise<SaldoEstrellas> {
  const [pagosVigentes, redenciones] = await Promise.all([
    contarPagosVigentesCliente(db, clienteId),
    getRedencionesCliente(db, clienteId),
  ]);
  return calcularEstrellas({ pagosVigentes, redenciones, cicloActual });
}

/** Inserta una solicitud de redención (estado 'pendiente'). */
export async function crearSolicitudRedencion(
  db: SupabaseClient,
  input: { clienteId: string; estrellas: number; ciclo: string; nota?: string | null },
): Promise<void> {
  const { error } = await db.from("estrellas_redenciones").insert({
    cliente_id: input.clienteId,
    estrellas: input.estrellas,
    ciclo: input.ciclo,
    estado: "pendiente",
    nota: input.nota ?? null,
  });
  if (error) throw error;
}

/** Una redención pendiente, con el nombre del cliente (para el panel admin). */
export interface RedencionPendiente {
  id: string;
  clienteId: string;
  clienteNombre: string;
  estrellas: number;
  ciclo: string;
  solicitadoEn: string;
  nota: string | null;
}

/** Lista las redenciones PENDIENTES para que el admin las resuelva. */
export async function getRedencionesPendientes(
  db: SupabaseClient,
): Promise<RedencionPendiente[]> {
  try {
    const { data, error } = await db
      .from("estrellas_redenciones")
      .select("id, cliente_id, estrellas, ciclo, solicitado_en, nota")
      .eq("estado", "pendiente")
      .order("solicitado_en", { ascending: true });
    if (error) throw error;
    const filas = data ?? [];
    const ids = [...new Set(filas.map((r) => (r as { cliente_id: string }).cliente_id))];
    const nombres = new Map<string, string>();
    if (ids.length > 0) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", ids);
      for (const c of cs ?? []) nombres.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    return filas.map((r) => {
      const row = r as {
        id: string; cliente_id: string; estrellas: number; ciclo: string;
        solicitado_en: string; nota: string | null;
      };
      return {
        id: row.id,
        clienteId: row.cliente_id,
        clienteNombre: nombres.get(row.cliente_id) ?? "—",
        estrellas: Number(row.estrellas),
        ciclo: row.ciclo,
        solicitadoEn: row.solicitado_en,
        nota: row.nota ?? null,
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Una redención resuelta (para el historial del admin). */
export interface RedencionHistorial {
  id: string;
  clienteId: string;
  clienteNombre: string;
  estrellas: number;
  ciclo: string;
  estado: "aprobada" | "rechazada";
  resueltoEn: string | null;
  resueltoPorNombre: string | null;
  nota: string | null;
}

/** Historial de redenciones RESUELTAS (aprobadas/rechazadas), más nuevas primero. */
export async function getHistorialRedenciones(
  db: SupabaseClient,
  limite = 40,
): Promise<RedencionHistorial[]> {
  try {
    const { data, error } = await db
      .from("estrellas_redenciones")
      .select("id, cliente_id, estrellas, ciclo, estado, resuelto_en, resuelto_por, nota")
      .neq("estado", "pendiente")
      .order("resuelto_en", { ascending: false, nullsFirst: false })
      .limit(Math.max(1, Math.min(200, limite)));
    if (error) throw error;
    const filas = data ?? [];
    const cliIds = [...new Set(filas.map((r) => (r as { cliente_id: string }).cliente_id))];
    const usrIds = [...new Set(filas.map((r) => (r as { resuelto_por: string | null }).resuelto_por).filter(Boolean) as string[])];
    const nomCli = new Map<string, string>();
    const nomUsr = new Map<string, string>();
    if (cliIds.length > 0) {
      const { data: cs } = await db.from("clientes").select("id, nombre").in("id", cliIds);
      for (const c of cs ?? []) nomCli.set((c as { id: string }).id, (c as { nombre: string }).nombre);
    }
    if (usrIds.length > 0) {
      const { data: us } = await db.from("usuarios").select("id, nombre").in("id", usrIds);
      for (const u of us ?? []) nomUsr.set((u as { id: string }).id, (u as { nombre: string }).nombre);
    }
    return filas.map((r) => {
      const row = r as {
        id: string; cliente_id: string; estrellas: number; ciclo: string;
        estado: "aprobada" | "rechazada"; resuelto_en: string | null; resuelto_por: string | null; nota: string | null;
      };
      return {
        id: row.id,
        clienteId: row.cliente_id,
        clienteNombre: nomCli.get(row.cliente_id) ?? "—",
        estrellas: Number(row.estrellas),
        ciclo: row.ciclo,
        estado: row.estado,
        resueltoEn: row.resuelto_en,
        resueltoPorNombre: row.resuelto_por ? nomUsr.get(row.resuelto_por) ?? null : null,
        nota: row.nota ?? null,
      };
    });
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Inserta una redención YA APROBADA (canje directo hecho por el admin en persona).
 *  Requiere `db` con permiso de escritura (service_role): la acción que la llama
 *  ya validó que es un gestor y que hay saldo/cupo. */
export async function redimirDirectoDb(
  db: SupabaseClient,
  input: { clienteId: string; estrellas: number; ciclo: string; resueltoPor: string; nota?: string | null },
): Promise<void> {
  const { error } = await db.from("estrellas_redenciones").insert({
    cliente_id: input.clienteId,
    estrellas: input.estrellas,
    ciclo: input.ciclo,
    estado: "aprobada",
    nota: input.nota ?? "Canje directo (admin)",
    resuelto_por: input.resueltoPor,
    resuelto_en: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Aprueba o rechaza una redención (marca quién y cuándo la resolvió). */
export async function resolverRedencionDb(
  db: SupabaseClient,
  id: string,
  estado: "aprobada" | "rechazada",
  resueltoPor: string,
): Promise<void> {
  const { error } = await db
    .from("estrellas_redenciones")
    .update({ estado, resuelto_por: resueltoPor, resuelto_en: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "pendiente"); // solo se resuelve una vez
  if (error) throw error;
}

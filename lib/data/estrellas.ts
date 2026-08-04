// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ESTRELLAS. Los fragmentos se DERIVAN del conteo de pagos NO
//  anulados; solo se persisten las redenciones (canjes). Resiliente: si 0020 no
//  corrió, las redenciones se tratan como vacías (el saldo se sigue mostrando).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstrellas, type RedencionMin, type SaldoEstrellas, type EstadoRedencion } from "@/lib/estrellas";
import { tablaFaltante, columnaFaltante } from "@/lib/data/errores";

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
    .eq("anulado", false)
    // SOLO pagos hechos EN LA APP (origen NULL). El historial importado de
    // Disapp (~176k pagos) daría estrellas masivas de arranque: un cliente con
    // 200 pagos importados nacería con 40 estrellas y podría canjear el tope de
    // 5 TODOS los meses por historia que Presta Ya nunca vio. El programa
    // arranca de cero con el piloto. (Si el negocio quisiera honrar la historia
    // de Disapp, es una decisión explícita de Mauricio — no un default.)
    .is("origen", null);
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

/** Una redención resuelta (para el registro del admin). Con folio/entrega/premio (0104). */
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
  /** Nº de comprobante verificable (solo aprobadas; 0104). null si falta 0104. */
  folio: number | null;
  premioTexto: string | null;
  /** Entrega física del premio, aparte de la aprobación (0104). */
  entregado: boolean;
  entregadoEn: string | null;
  entregadoPorNombre: string | null;
}

const REDEN_COLS_NEW =
  "id, cliente_id, estrellas, ciclo, estado, resuelto_en, resuelto_por, nota, folio, premio_texto, entregado, entregado_en, entregado_por";
const REDEN_COLS_OLD = "id, cliente_id, estrellas, ciclo, estado, resuelto_en, resuelto_por, nota";

/** Registro de redenciones RESUELTAS (aprobadas/rechazadas), más nuevas primero.
 *  Trae folio/entrega/premio si 0104 corrió; degrada al set viejo si no. */
export async function getHistorialRedenciones(
  db: SupabaseClient,
  limite = 60,
): Promise<RedencionHistorial[]> {
  const tope = Math.max(1, Math.min(500, limite));
  try {
    let filas: Record<string, unknown>[];
    const r = await db
      .from("estrellas_redenciones")
      .select(REDEN_COLS_NEW)
      .neq("estado", "pendiente")
      .order("resuelto_en", { ascending: false, nullsFirst: false })
      .limit(tope);
    if (r.error) {
      if (!columnaFaltante(r.error)) throw r.error;
      // 0104 sin correr → set de columnas viejo (sin folio/entrega/premio).
      const r2 = await db
        .from("estrellas_redenciones")
        .select(REDEN_COLS_OLD)
        .neq("estado", "pendiente")
        .order("resuelto_en", { ascending: false, nullsFirst: false })
        .limit(tope);
      if (r2.error) throw r2.error;
      filas = (r2.data ?? []) as Record<string, unknown>[];
    } else {
      filas = (r.data ?? []) as Record<string, unknown>[];
    }
    const cliIds = [...new Set(filas.map((x) => x.cliente_id as string))];
    const usrIds = [
      ...new Set(filas.flatMap((x) => [x.resuelto_por, x.entregado_por]).filter(Boolean) as string[]),
    ];
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
    return filas.map((x) => ({
      id: x.id as string,
      clienteId: x.cliente_id as string,
      clienteNombre: nomCli.get(x.cliente_id as string) ?? "—",
      estrellas: Number(x.estrellas),
      ciclo: x.ciclo as string,
      estado: x.estado as "aprobada" | "rechazada",
      resueltoEn: (x.resuelto_en as string | null) ?? null,
      resueltoPorNombre: x.resuelto_por ? nomUsr.get(x.resuelto_por as string) ?? null : null,
      nota: (x.nota as string | null) ?? null,
      folio: x.folio == null ? null : Number(x.folio),
      premioTexto: (x.premio_texto as string | null | undefined) ?? null,
      entregado: Boolean(x.entregado),
      entregadoEn: (x.entregado_en as string | null | undefined) ?? null,
      entregadoPorNombre: x.entregado_por ? nomUsr.get(x.entregado_por as string) ?? null : null,
    }));
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Métricas agregadas del programa de estrellas (para el panel del admin). */
export interface MetricasEstrellas {
  /** Redenciones aprobadas (canjes concretados). */
  canjes: number;
  /** Σ estrellas canjeadas (aprobadas). */
  estrellasCanjeadas: number;
  /** Solicitudes pendientes de aprobar. */
  pendientes: number;
  /** Aprobadas ya ENTREGADAS al cliente (0104). */
  entregadas: number;
  /** Aprobadas que faltan ENTREGAR (0104). */
  porEntregar: number;
}

export async function getMetricasEstrellas(db: SupabaseClient): Promise<MetricasEstrellas> {
  const vacio: MetricasEstrellas = { canjes: 0, estrellasCanjeadas: 0, pendientes: 0, entregadas: 0, porEntregar: 0 };
  // Las redenciones son de bajo volumen (promocional): traer las aprobadas y sumar
  // en JS es barato. `entregado` puede faltar (0104 sin correr) → reintento sin ella.
  const contarPend = async () => {
    const { count } = await db.from("estrellas_redenciones").select("*", { count: "exact", head: true }).eq("estado", "pendiente");
    return count ?? 0;
  };
  try {
    const r = await db.from("estrellas_redenciones").select("estrellas, entregado").eq("estado", "aprobada").limit(3000);
    if (r.error) {
      if (!columnaFaltante(r.error)) throw r.error;
      const r2 = await db.from("estrellas_redenciones").select("estrellas").eq("estado", "aprobada").limit(3000);
      if (r2.error) throw r2.error;
      const rows = (r2.data ?? []) as { estrellas: number }[];
      return { canjes: rows.length, estrellasCanjeadas: rows.reduce((s, x) => s + Number(x.estrellas), 0), pendientes: await contarPend(), entregadas: 0, porEntregar: rows.length };
    }
    const rows = (r.data ?? []) as { estrellas: number; entregado?: boolean }[];
    const entregadas = rows.filter((x) => x.entregado).length;
    return {
      canjes: rows.length,
      estrellasCanjeadas: rows.reduce((s, x) => s + Number(x.estrellas), 0),
      pendientes: await contarPend(),
      entregadas,
      porEntregar: rows.length - entregadas,
    };
  } catch (e) {
    if (tablaFaltante(e)) return vacio;
    throw e;
  }
}

/** Marca una redención APROBADA como ENTREGADA (premio recibido por el cliente). */
export async function marcarEntregadaDb(db: SupabaseClient, id: string, usuarioId: string): Promise<void> {
  const { error } = await db
    .from("estrellas_redenciones")
    .update({ entregado: true, entregado_en: new Date().toISOString(), entregado_por: usuarioId })
    .eq("id", id)
    .eq("estado", "aprobada") // solo se entrega algo aprobado
    .eq("entregado", false); // idempotente: congela quién/cuándo la 1ª vez (no lo pisa un 2º clic)
  if (error) throw error;
}

/** Inserta una redención YA APROBADA (canje directo hecho por el admin en persona).
 *  Requiere `db` con permiso de escritura (service_role): la acción que la llama
 *  ya validó que es un gestor y que hay saldo/cupo. */
export async function redimirDirectoDb(
  db: SupabaseClient,
  input: { clienteId: string; estrellas: number; ciclo: string; resueltoPor: string; nota?: string | null; premioTexto?: string | null },
): Promise<void> {
  const fila: Record<string, unknown> = {
    cliente_id: input.clienteId,
    estrellas: input.estrellas,
    ciclo: input.ciclo,
    estado: "aprobada",
    nota: input.nota ?? "Canje directo (admin)",
    resuelto_por: input.resueltoPor,
    resuelto_en: new Date().toISOString(),
  };
  if (input.premioTexto) fila.premio_texto = input.premioTexto;
  let { error } = await db.from("estrellas_redenciones").insert(fila);
  // 0104 sin correr → insertar sin premio_texto (conducta previa).
  if (error && input.premioTexto && columnaFaltante(error)) {
    delete fila.premio_texto;
    ({ error } = await db.from("estrellas_redenciones").insert(fila));
  }
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

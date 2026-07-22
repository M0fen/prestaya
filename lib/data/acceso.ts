// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ALTA DEL CLIENTE EN LA APP (0084).
//
//  Dos señales, distintas a propósito:
//    · ENTREGADO → lo declara el cobrador al compartir el link/QR.
//    · VISTO     → el cliente abrió su cartón. Es la prueba real del alta.
//
//  Todo degrada en silencio si 0084 aún no corrió: dar de alta a un cliente
//  nunca puede romperse por una columna que falta, y la vista del cliente
//  MENOS todavía (es solo telemetría del despliegue, no es plata).
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCliente } from "./clientes";
import { alcanceDelActor, esGlobal, enLotes } from "./alcance";
import { traerTodo } from "./paginado";
import { columnaFaltante } from "./errores";

/**
 * Marca que el cobrador YA le entregó el link al cliente.
 * Va por service_role a propósito: el cobrador no tiene UPDATE sobre `clientes`
 * (RLS 0031). Quien llama DEBE haber verificado antes, con el cliente RLS, que
 * ese cliente es suyo (ver lib/acciones/acceso.ts).
 */
export async function marcarAccesoEntregado(
  clienteId: string,
  usuarioId: string,
): Promise<void> {
  const admin = createSupabaseAdmin();
  try {
    const { error } = await admin
      .from("clientes")
      .update({ acceso_entregado_en: new Date().toISOString(), acceso_entregado_por: usuarioId })
      .eq("id", clienteId);
    if (error) throw error;
  } catch (e) {
    if (!columnaFaltante(e)) throw e; // 0084 sin correr → seguimos sin registrar
  }
}

/**
 * Sella la PRIMERA visita del cliente a su cartón. Solo escribe si estaba en
 * null (`.is(...)` lo garantiza también ante dos pestañas a la vez), así que
 * es un único UPDATE en la vida del cliente, no uno por carga.
 * Nunca lanza: la vista del cliente no se cae por esto.
 */
export async function marcarAccesoVisto(db: SupabaseClient, clienteId: string): Promise<void> {
  try {
    await db
      .from("clientes")
      .update({ acceso_visto_en: new Date().toISOString() })
      .eq("id", clienteId)
      .is("acceso_visto_en", null);
  } catch {
    /* telemetría del alta: jamás rompe el cartón del cliente */
  }
}

/** Cliente de la ruta con el estado de su alta (pantalla /cobrador/altas). */
export interface ClienteAlta {
  id: string;
  nombre: string;
  telefono: string | null;
  numeroRegistro: number | null;
  estado: EstadoAlta;
  entregadoEn: string | null;
  vistoEn: string | null;
}

/**
 * Clientes ACTIVOS asignados al cobrador logueado, con el estado de su alta.
 * Mismo patrón que la ruta (asignaciones → `.in(ids)`): el RLS se evalúa solo
 * sobre esas decenas de filas, no sobre los 13k clientes.
 * Orden: primero los que FALTAN (es una lista de trabajo), después por nombre.
 */
export async function getAltasDeMiRuta(db: SupabaseClient): Promise<ClienteAlta[]> {
  const { data: asig, error } = await db.from("asignaciones").select("cliente_id").eq("activo", true);
  if (error) throw error;
  const ids = [...new Set((asig ?? []).map((a) => a.cliente_id as string))];
  if (ids.length === 0) return [];

  // select("*") a propósito: si 0084 todavía no corrió, pedir las columnas por
  // nombre daría 42703; así `mapCliente` las degrada a null y la lista funciona.
  const { data, error: e2 } = await db
    .from("clientes")
    .select("*")
    .in("id", ids)
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (e2) throw e2;

  const PESO: Record<EstadoAlta, number> = { pendiente: 0, entregado: 1, activo: 2 };
  return (data ?? [])
    .map((r) => {
      const c = mapCliente(r);
      return {
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        numeroRegistro: c.numero_registro,
        estado: estadoAlta(c),
        entregadoEn: c.acceso_entregado_en,
        vistoEn: c.acceso_visto_en,
      };
    })
    .sort((a, b) => PESO[a.estado] - PESO[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
}

/** Avance del alta por cobrador (tablero de la oficina). */
export interface FilaAltas {
  cobradorId: string;
  cobradorNombre: string;
  total: number;
  activos: number;
  entregados: number;
  pendientes: number;
}

export interface ResumenAltas {
  /** true = 0084 todavía no corrió: no se puede medir el avance. */
  migracionPendiente: boolean;
  filas: FilaAltas[];
  totales: { total: number; activos: number; entregados: number; pendientes: number };
}

/**
 * Avance de la entrega de cartones por cobrador, acotado a la zona del gestor
 * (el supervisor ve su zona; el admin, todo). Lectura por service_role sobre
 * conjuntos de IDs ya acotados — mismo patrón que el resto del panel.
 */
export async function getResumenAltas(): Promise<ResumenAltas> {
  const alcance = await alcanceDelActor();
  const admin = createSupabaseAdmin();

  // 1) Cobradores en alcance.
  let qCob = admin.from("usuarios").select("id, nombre").eq("rol", "cobrador").eq("activo", true);
  if (!esGlobal(alcance)) qCob = qCob.in("id", alcance.cobradorIds);
  const { data: cobs, error: eCob } = await qCob.order("nombre", { ascending: true });
  if (eCob) throw eCob;
  const cobradores = (cobs ?? []) as { id: string; nombre: string }[];
  if (cobradores.length === 0) {
    return { migracionPendiente: false, filas: [], totales: { total: 0, activos: 0, entregados: 0, pendientes: 0 } };
  }

  // 2) Asignaciones activas de esos cobradores. PAGINADO: con miles de filas,
  //    el tope de 1000 de PostgREST truncaría el avance en silencio.
  const asignaciones: { cliente_id: string; cobrador_id: string }[] = [];
  for (const lote of enLotes(cobradores.map((c) => c.id))) {
    const filas = await traerTodo<{ cliente_id: string; cobrador_id: string }>((d, h) =>
      admin
        .from("asignaciones")
        .select("cliente_id, cobrador_id")
        .eq("activo", true)
        .in("cobrador_id", lote)
        .order("cliente_id", { ascending: true })
        .range(d, h),
    );
    asignaciones.push(...filas);
  }
  if (asignaciones.length === 0) {
    return {
      migracionPendiente: false,
      filas: cobradores.map((c) => ({ cobradorId: c.id, cobradorNombre: c.nombre, total: 0, activos: 0, entregados: 0, pendientes: 0 })),
      totales: { total: 0, activos: 0, entregados: 0, pendientes: 0 },
    };
  }

  // 3) Estado del alta de esos clientes (solo los activos: los de baja no cuentan).
  const estados = new Map<string, EstadoAlta>();
  try {
    for (const lote of enLotes([...new Set(asignaciones.map((a) => a.cliente_id))])) {
      const { data, error } = await admin
        .from("clientes")
        .select("id, acceso_entregado_en, acceso_visto_en")
        .in("id", lote)
        .eq("activo", true);
      if (error) throw error;
      for (const c of data ?? []) {
        estados.set(
          c.id as string,
          estadoAlta({
            acceso_entregado_en: (c.acceso_entregado_en as string | null) ?? null,
            acceso_visto_en: (c.acceso_visto_en as string | null) ?? null,
          }),
        );
      }
    }
  } catch (e) {
    if (columnaFaltante(e)) {
      return { migracionPendiente: true, filas: [], totales: { total: 0, activos: 0, entregados: 0, pendientes: 0 } };
    }
    throw e;
  }

  // 4) Agregar por cobrador. Un cliente puede estar asignado a uno solo, pero si
  //    hubiera duplicados la cuenta sigue siendo por asignación activa.
  const acc = new Map<string, FilaAltas>();
  for (const c of cobradores) {
    acc.set(c.id, { cobradorId: c.id, cobradorNombre: c.nombre, total: 0, activos: 0, entregados: 0, pendientes: 0 });
  }
  for (const a of asignaciones) {
    const fila = acc.get(a.cobrador_id);
    const estado = estados.get(a.cliente_id);
    if (!fila || !estado) continue; // cliente dado de baja → fuera de la cuenta
    fila.total += 1;
    if (estado === "activo") fila.activos += 1;
    else if (estado === "entregado") fila.entregados += 1;
    else fila.pendientes += 1;
  }

  const filas = [...acc.values()].sort((x, y) => y.pendientes - x.pendientes || x.cobradorNombre.localeCompare(y.cobradorNombre, "es"));
  const totales = filas.reduce(
    (t, f) => ({
      total: t.total + f.total,
      activos: t.activos + f.activos,
      entregados: t.entregados + f.entregados,
      pendientes: t.pendientes + f.pendientes,
    }),
    { total: 0, activos: 0, entregados: 0, pendientes: 0 },
  );
  return { migracionPendiente: false, filas, totales };
}

/** Estado del alta, listo para mostrar. */
export type EstadoAlta = "activo" | "entregado" | "pendiente";

export function estadoAlta(c: {
  acceso_visto_en: string | null;
  acceso_entregado_en: string | null;
}): EstadoAlta {
  if (c.acceso_visto_en) return "activo";
  if (c.acceso_entregado_en) return "entregado";
  return "pendiente";
}

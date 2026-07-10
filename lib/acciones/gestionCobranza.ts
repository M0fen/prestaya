"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — GESTIONES DE COBRANZA (mini-CRM). Las usa el gestor
//  (admin/supervisor). El insert va como el usuario logueado → la RLS de 0055
//  valida que el cliente sea de SU zona. Append-only + auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import {
  registrarGestionDb,
  getGestionesCliente,
  type Gestion,
  type TipoGestion,
} from "@/lib/data/gestionesCobranza";
import { registrarAuditoria } from "@/lib/data/auditoria";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS: TipoGestion[] = ["visita", "llamada", "mensaje", "compromiso", "acuerdo", "ilocalizable", "otro"];
const ETIQUETA: Record<TipoGestion, string> = {
  visita: "Visita",
  llamada: "Llamada",
  mensaje: "Mensaje",
  compromiso: "Compromiso de pago",
  acuerdo: "Acuerdo",
  ilocalizable: "Ilocalizable",
  otro: "Gestión",
};

type Resultado = { ok: true } | { ok: false; error: string };

export interface EntradaGestion {
  clienteId: string;
  tipo: TipoGestion;
  resultado?: string | null;
  montoCompromiso?: number | null;
  fechaCompromiso?: string | null;
}

/** Registra una gestión de cobranza sobre un cliente de la zona del gestor. */
export async function registrarGestion(input: EntradaGestion): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(input.clienteId)) return { ok: false, error: "Cliente inválido." };
  if (!TIPOS.includes(input.tipo)) return { ok: false, error: "Tipo de gestión inválido." };

  const resultado = (input.resultado ?? "").trim().slice(0, 500) || null;

  // Compromiso: monto y fecha van juntos (o ninguno). Fecha razonable (no pasada
  // más de 1 día, no a más de 1 año). Monto entero positivo.
  let monto: number | null = null;
  let fecha: string | null = null;
  const tieneMonto = input.montoCompromiso != null && input.montoCompromiso > 0;
  const tieneFecha = !!input.fechaCompromiso;
  if (tieneMonto || tieneFecha) {
    if (!tieneMonto || !tieneFecha) return { ok: false, error: "El compromiso necesita monto y fecha." };
    if (!ES_FECHA.test(input.fechaCompromiso as string)) return { ok: false, error: "Fecha de compromiso inválida." };
    monto = Math.round(input.montoCompromiso as number);
    if (monto <= 0 || monto > 100_000_000) return { ok: false, error: "Monto de compromiso fuera de rango." };
    fecha = input.fechaCompromiso as string;
  }

  try {
    const db = await createSupabaseServer();
    await registrarGestionDb(db, {
      clienteId: input.clienteId,
      prestamoId: null,
      gestorId: u.id,
      gestorNombre: u.nombre,
      tipo: input.tipo,
      resultado,
      montoCompromiso: monto,
      fechaCompromiso: fecha,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: monto != null ? `Registró compromiso de pago (${ETIQUETA[input.tipo]})` : `Registró gestión de cobranza (${ETIQUETA[input.tipo]})`,
      entidad: "gestiones_cobranza",
      entidadId: input.clienteId,
    });
    revalidatePath("/admin/mora");
    revalidatePath("/admin/jornada");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0055?" };
  }
}

/** Carga el timeline de gestiones de un cliente (para el modal). Gateado por zona. */
export async function cargarGestionesCliente(
  clienteId: string,
): Promise<{ ok: true; gestiones: Gestion[] } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };
  try {
    const db = await createSupabaseServer();
    const gestiones = await getGestionesCliente(db, clienteId);
    return { ok: true, gestiones };
  } catch {
    return { ok: false, error: "No se pudieron cargar las gestiones." };
  }
}

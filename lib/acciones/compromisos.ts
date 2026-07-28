"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — el COBRADOR registra un COMPROMISO de pago del cliente
//  ("el viernes te pago $X"). Va al mismo mini-CRM que ve el supervisor
//  (gestiones_cobranza, tipo 'compromiso'), y se AUTO-VERIFICA contra los pagos.
//  RLS (0059): el cobrador solo puede registrar compromisos de SUS clientes.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { registrarGestionDb } from "@/lib/data/gestionesCobranza";

type Resultado = { ok: true } | { ok: false; error: string };

export async function registrarCompromiso(input: {
  clienteId: string;
  prestamoId?: string | null;
  monto: number;
  fecha: string; // "YYYY-MM-DD"
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };

  const monto = Math.round(Number(input.monto) || 0);
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha ?? "")) return { ok: false, error: "Elegí una fecha válida." };

  try {
    // RLS (0059): el insert solo pasa si el cliente es del cobrador (o es gestor).
    const db = await createSupabaseServer();
    await registrarGestionDb(db, {
      clienteId: input.clienteId,
      prestamoId: input.prestamoId ?? null,
      gestorId: usuario.id,
      gestorNombre: usuario.nombre,
      tipo: "compromiso",
      resultado: "Prometió pagar",
      montoCompromiso: monto,
      fechaCompromiso: input.fecha,
    });
    revalidatePath(`/cobrador/cliente/${input.clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo registrar el compromiso. Probá de nuevo." };
  }
}

"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — ALTA REAL del crédito de renovación (solo gestor).
//  Escribe dinero: finaliza el crédito saldado y crea el nuevo, arrastrando la
//  tasa (la cuota la calcula el servidor, ver lib/data/renovaciones.ts).
//  Corre con la sesión del gestor → el RLS exige app_es_gestor().
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { crearRenovacion, type ResultadoAlta } from "@/lib/data/renovaciones";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";
import type { FrecuenciaPrestamo } from "@/types/db";

export async function renovarCredito(input: {
  clienteId: string;
  prestamoAnteriorId: string;
  monto: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
}): Promise<ResultadoAlta> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos para dar de alta créditos." };
  }

  const db = await createSupabaseServer();
  const res = await crearRenovacion(db, {
    clienteId: input.clienteId,
    prestamoAnteriorId: input.prestamoAnteriorId,
    monto: Math.round(Number(input.monto)),
    totalDias: Math.round(Number(input.totalDias)),
    frecuencia: input.frecuencia,
    creadoPor: usuario.id,
  });

  if (res.ok) {
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Renovó crédito",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `Nuevo crédito ${UYU(Math.round(Number(input.monto)))} × ${Math.round(Number(input.totalDias))} (${input.frecuencia})`,
    });
    // El nuevo crédito cambia cartera, mora y renovaciones.
    revalidatePath("/admin/renovaciones");
    revalidatePath("/admin/mora");
    revalidatePath("/admin");
  }
  return res;
}

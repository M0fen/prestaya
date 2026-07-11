"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — GASTOS DE RUTA con APROBACIÓN del admin (0057).
//   · solicitarGastoRuta  → el COBRADOR pide sacar plata para un gasto (queda
//     pendiente; NO sale de la caja todavía).
//   · aprobarGastoRuta    → SOLO el ADMIN aprueba: recién ahí se crea el egreso
//     real en la caja (a nombre del cobrador) y la solicitud queda "aprobada".
//   · rechazarGastoRuta   → SOLO el ADMIN rechaza.
//  La aprobación/rechazo escriben con service_role (no hay UPDATE por RLS).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { registrarMovimientoCaja } from "@/lib/data/caja";
import { getSolicitudGasto } from "@/lib/data/solicitudesGasto";
import { registrarBitacora } from "@/lib/data/bitacora";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

const CATEGORIAS = new Set(["Combustible", "Comida", "Peaje", "Otro"]);

/** (Cobrador) Solicita un gasto de ruta. Queda PENDIENTE de aprobación del admin. */
export async function solicitarGastoRuta(input: {
  monto: number;
  categoria?: string | null;
  descripcion?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "cobrador") {
    return { ok: false, error: "Solo un cobrador puede solicitar un gasto." };
  }
  const monto = Math.round(Number(input.monto) || 0);
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  const categoria = CATEGORIAS.has(input.categoria ?? "") ? (input.categoria as string) : "Otro";
  const descripcion = (input.descripcion ?? "").trim().slice(0, 160) || null;

  try {
    const db = await createSupabaseServer();
    const { error } = await db.from("solicitudes_gasto").insert({
      cobrador_id: usuario.id,
      monto,
      categoria,
      descripcion,
      solicitado_por: usuario.id,
      solicitado_por_nombre: usuario.nombre,
    });
    if (error) return { ok: false, error: "No se pudo enviar la solicitud. ¿Corriste la migración 0057?" };
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "gasto",
      monto,
      detalle: `Solicitó gasto: ${categoria}`,
    });
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo enviar la solicitud. Probá de nuevo." };
  }
}

/** (Admin) Aprueba: crea el egreso real y marca la solicitud aprobada. */
export async function aprobarGastoRuta(input: { solicitudId: string }): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "admin") {
    return { ok: false, error: "Solo el administrador aprueba gastos." };
  }
  const db = await createSupabaseServer();
  const sol = await getSolicitudGasto(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  const admin = createSupabaseAdmin();
  try {
    // Recién ahora el gasto es plata real: se crea el egreso a nombre del cobrador.
    await registrarMovimientoCaja(admin, {
      tipo: "egreso",
      categoria: sol.categoria ?? "Gasto de ruta",
      monto: sol.monto,
      descripcion: sol.descripcion,
      cobradorId: sol.cobradorId,
      registradoPor: usuario.id,
    });
  } catch {
    return { ok: false, error: "No se pudo crear el egreso en la caja." };
  }
  // Marca aprobada (idempotente: solo si seguía pendiente).
  const { data } = await admin
    .from("solicitudes_gasto")
    .update({
      estado: "aprobada",
      resuelto_por: usuario.id,
      resuelto_por_nombre: usuario.nombre,
      resuelto_en: new Date().toISOString(),
    })
    .eq("id", sol.id)
    .eq("estado", "pendiente")
    .select("id");
  await registrarAuditoria(admin, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    accion: "Aprobó un gasto de ruta",
    entidad: "gasto",
    entidadId: sol.id,
    detalle: `${sol.cobradorNombre ?? "Cobrador"} · $${sol.monto.toLocaleString("es-UY")} · ${sol.categoria ?? "—"}`,
  });
  revalidatePath("/admin/gastos");
  if (!data || data.length === 0) return { ok: false, error: "La solicitud ya había sido resuelta." };
  return { ok: true };
}

/** (Admin) Rechaza la solicitud (no crea egreso). */
export async function rechazarGastoRuta(input: { solicitudId: string; motivo?: string }): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "admin") {
    return { ok: false, error: "Solo el administrador rechaza gastos." };
  }
  const db = await createSupabaseServer();
  const sol = await getSolicitudGasto(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  const admin = createSupabaseAdmin();
  await admin
    .from("solicitudes_gasto")
    .update({
      estado: "rechazada",
      resuelto_por: usuario.id,
      resuelto_por_nombre: usuario.nombre,
      resuelto_en: new Date().toISOString(),
      motivo_rechazo: (input.motivo ?? "").trim() || null,
    })
    .eq("id", sol.id)
    .eq("estado", "pendiente");
  await registrarAuditoria(admin, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    accion: "Rechazó un gasto de ruta",
    entidad: "gasto",
    entidadId: sol.id,
    detalle: `${sol.cobradorNombre ?? "Cobrador"} · $${sol.monto.toLocaleString("es-UY")}`,
  });
  revalidatePath("/admin/gastos");
  return { ok: true };
}

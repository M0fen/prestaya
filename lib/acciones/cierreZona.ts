"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — CERRAR LA CAJA DE UNA ZONA (supervisor de esa zona / admin).
//  El supervisor confirma que recibió el efectivo de sus cobradores y lo entrega
//  a la caja central. Los totales son AUTORITATIVOS del servidor (se recalculan
//  acá, no se confía en el cliente). Un solo cierre por zona y día. Degrada si
//  falta la migración 0047. Queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { getUsuarioActual, getActorActual } from "@/lib/auth";
import { puedeVerZona } from "@/lib/permisos";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { getCierrePorZona } from "@/lib/data/cierreZona";
import { UYU } from "@/lib/format";

type Resultado = { ok: true } | { ok: false; error: string };

/** Un unique violation (ya se cerró esa zona hoy) se trata como "ya cerrada". */
function esDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function confirmarCierreZona(input: {
  zonaId: string;
  notas?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión no válida." };
  const actor = await getActorActual();
  if (!actor) return { ok: false, error: "Sesión no válida." };

  // Solo el admin, o el supervisor de ESA zona, cierra la zona.
  const puede =
    actor.rol === "admin" || (actor.rol === "supervisor" && puedeVerZona(actor, input.zonaId));
  if (!puede) return { ok: false, error: "No podés cerrar esta zona." };

  // Kill switch (modo solo-lectura): el cierre de zona es una escritura de
  // custodia de efectivo (registro autoritativo de handoff + unique por zona/día),
  // así que durante un freeze SÍ se bloquea, igual que el resto de las escrituras
  // de plata. Se puede reintentar cuando se levanta el modo solo-lectura.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  const db = await createSupabaseServer();

  // Totales AUTORITATIVOS del servidor: se recalculan del cierre real de hoy.
  const { consolidado } = await getCierrePorZona(db);
  const zona = consolidado.zonas.find((z) => z.zonaId === input.zonaId);
  if (!zona) return { ok: false, error: "No hay recaudo en esa zona hoy." };

  const diferencia = zona.totalEntregado - zona.totalEsperado;
  const notas = (input.notas ?? "").toString().trim().slice(0, 300) || null;

  try {
    const { error } = await db.from("cierres_zona").insert({
      zona_id: input.zonaId,
      supervisor_id: u.id,
      supervisor_nombre: u.nombre,
      total_esperado: zona.totalEsperado,
      total_entregado: zona.totalEntregado,
      diferencia,
      cobradores_rendidos: zona.rendidos,
      cobradores_pendientes: zona.pendientes,
      notas,
    });
    if (error) throw error;

    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Cerró la caja de una zona",
      entidad: "cierre_zona",
      entidadId: input.zonaId,
      detalle: `${zona.zonaNombre}: entregó ${UYU(zona.totalEntregado)} (esperado ${UYU(
        zona.totalEsperado,
      )}${diferencia !== 0 ? `, ${diferencia < 0 ? "faltan" : "sobran"} ${UYU(Math.abs(diferencia))}` : ""})`,
    });
    revalidatePath("/admin/caja");
    return { ok: true };
  } catch (e) {
    if (esDuplicado(e)) return { ok: false, error: "Esa zona ya se cerró hoy." };
    return { ok: false, error: "No se pudo cerrar la zona. Probá de nuevo." };
  }
}

"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — REASIGNAR un cliente a otro cobrador (decisión 4).
//   · admin: puede mover a cualquier cobrador (incluso cruzando zonas).
//   · supervisor: solo entre SUS cobradores de la MISMA zona.
//  La regla la decide el núcleo puro permisos.ts (puedeReasignarCliente).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { getZonasDeSupervisor } from "@/lib/data/zonas";
import { actorDesde, puedeReasignarCliente } from "@/lib/permisos";
import { getCobradorDeCliente, reasignarCliente } from "@/lib/data/asignaciones";
import { registrarAuditoria } from "@/lib/data/auditoria";

type Resultado = { ok: true } | { ok: false; error: string };

export async function reasignarClienteAction(input: {
  clienteId: string;
  nuevoCobradorId: string;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Sesión no válida." };
  const zonas = u.rol === "supervisor" ? await getZonasDeSupervisor(await createSupabaseServer(), u.id) : [];
  const actor = actorDesde(u, zonas);

  const db = await createSupabaseServer();

  // Zona de origen (cobrador actual) y de destino (nuevo cobrador).
  const actual = await getCobradorDeCliente(db, input.clienteId);
  const { data: nuevo } = await db
    .from("usuarios")
    .select("nombre, zona_id, rol")
    .eq("id", input.nuevoCobradorId)
    .maybeSingle();
  if (!nuevo || (nuevo as { rol?: string }).rol !== "cobrador")
    return { ok: false, error: "Elegí un cobrador válido." };

  const zonaOrigen = actual?.zonaId ?? null;
  const zonaDestino = (nuevo as { zona_id?: string | null }).zona_id ?? null;

  if (!puedeReasignarCliente(actor, zonaOrigen, zonaDestino))
    return {
      ok: false,
      error:
        actor.rol === "supervisor"
          ? "Solo podés reasignar entre tus cobradores de la misma zona."
          : "No tenés permiso para reasignar este cliente.",
    };

  try {
    await reasignarCliente(db, input.clienteId, input.nuevoCobradorId);
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Reasignó un cliente a otro cobrador",
      entidad: "cliente",
      entidadId: input.clienteId,
      detalle: `${actual?.cobradorNombre ?? "sin cobrador"} → ${(nuevo as { nombre?: string }).nombre ?? "—"}`,
    });
    revalidatePath(`/admin/clientes/${input.clienteId}`);
    return { ok: true };
  } catch (e) {
    // La reasignación son varias escrituras; si falla la del DUEÑO de los créditos
    // (comisión) el cambio quedó a medias y el gestor tiene que saberlo con
    // precisión, no con un "no se pudo" que sugiere que no pasó nada.
    const detalle = e instanceof Error ? e.message : "";
    return {
      ok: false,
      error: detalle.startsWith("La ruta se cambió")
        ? `${detalle} Avisá a la oficina para corregirlo.`
        : "No se pudo reasignar el cliente.",
    };
  }
}

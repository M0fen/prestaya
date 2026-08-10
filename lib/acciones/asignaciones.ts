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

  // ⚠️ CLIENTE COMPARTIDO: el freno que faltaba.
  //
  // Mover "el cliente" mueve TODOS sus créditos activos, y hoy hay 54 clientes con
  // créditos vivos de DOS cobradores distintos (84 créditos, $5,6M de capital). En
  // esas fichas el encabezado muestra UN solo nombre —el de la asignación más
  // reciente— así que quien toca el desplegable no tiene forma de saber que le está
  // sacando al compañero créditos que él colocó y está cobrando: su comisión de la
  // quincena se re-imputa y el cliente le desaparece de la ruta, sin aviso y sin
  // vuelta atrás desde la pantalla.
  //
  // El motor YA sabe mover un solo crédito (`soloPrestamoId`, implementado y
  // testeado), pero ninguna pantalla lo usa todavía. Hasta que exista esa pantalla,
  // el caso ambiguo NO se resuelve adivinando: se frena nombrando al compañero.
  // Los ~2.200 clientes de un solo dueño siguen moviéndose igual que siempre.
  const { data: activos } = await db
    .from("prestamos")
    .select("cobrador_id")
    .eq("cliente_id", input.clienteId)
    .eq("estado", "activo");
  const duenos = [
    ...new Set((activos ?? []).map((p) => p.cobrador_id as string | null).filter(Boolean)),
  ] as string[];
  const ajenos = duenos.filter((id) => id !== input.nuevoCobradorId);
  if (ajenos.length > 1) {
    const { data: quienes } = await db.from("usuarios").select("id, nombre").in("id", ajenos);
    const nombres = (quienes ?? []).map((x) => x.nombre as string).filter(Boolean);
    return {
      ok: false,
      error:
        `Este cliente tiene créditos vivos de ${ajenos.length} cobradores` +
        (nombres.length > 0 ? ` (${nombres.join(" y ")})` : "") +
        `. Moverlo se los sacaría a los dos, junto con su comisión. Movelo desde la oficina, crédito por crédito.`,
    };
  }

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

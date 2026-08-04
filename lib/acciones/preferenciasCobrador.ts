"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — PREFERENCIAS del cobrador (0132).
//   · guardarOrdenRuta: persiste el recorrido que el cobrador se armó (la
//     posición de cada cliente en SU ruta). No toca dinero; solo escribe
//     `asignaciones.orden` de asignaciones QUE SON SUYAS (verificado por RLS:
//     lo que no es suyo, no lo ve — y por lo tanto no puede ordenarlo).
//   · setApodo: el sobrenombre que se muestra a terceros en lugar del nombre
//     real (comprobante compartido por WhatsApp).
//  Ambas escriben con service_role tras validar la sesión: la RLS de UPDATE
//  de `asignaciones`/`usuarios` NO se abre al navegador.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";

type Resultado = { ok: true } | { ok: false; error: string };

const esUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Guarda el orden del recorrido: `clienteIds[i]` queda en la posición i.
 * Solo se tocan asignaciones ACTIVAS del PROPIO cobrador; ids ajenos o
 * desconocidos se ignoran en silencio (no rompen el guardado del resto).
 */
export async function guardarOrdenRuta(input: { clienteIds: string[] }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (u.rol !== "cobrador") return { ok: false, error: "El orden de la ruta es del cobrador." };
  const ids = (input.clienteIds ?? []).filter((x) => typeof x === "string" && esUuid(x));
  if (ids.length === 0) return { ok: false, error: "No hay clientes para ordenar." };
  if (ids.length > 500) return { ok: false, error: "Demasiados clientes." };

  // RPC atómica (0133): UPDATE de `orden` SOLO sobre asignaciones ACTIVAS del
  // PROPIO cobrador (el id de sesión va como parámetro; el navegador no elige).
  // Se reemplazó el upsert original: si la oficina desactivaba/borraba una
  // asignación entre el fetch y el guardado, el upsert la RE-ACTIVABA/RE-CREABA
  // (un cobrador "recuperando" en silencio un cliente que le sacaron). La RPC
  // no crea ni reactiva nada: lo que ya no es suyo, simplemente no se toca.
  const admin = createSupabaseAdmin();
  const { data: n, error: eRpc } = await admin.rpc("app_guardar_orden_ruta", {
    p_cobrador: u.id,
    p_clientes: ids,
  });
  if (eRpc) return { ok: false, error: "No se pudo guardar el orden. Probá de nuevo." };
  if (Number(n ?? 0) === 0) return { ok: false, error: "Esos clientes no están en tu ruta." };

  revalidatePath("/cobrador");
  return { ok: true };
}

/** Fija el sobrenombre del PROPIO usuario (vacío = volver al nombre real). */
export async function setApodo(input: { apodo: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  // Una sola línea, sin espacios raros; 24 máx (mismo límite que el CHECK 0132).
  const limpio = (input.apodo ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("usuarios")
    .update({ apodo: limpio.length > 0 ? limpio : null })
    .eq("id", u.id);
  if (error) return { ok: false, error: "No se pudo guardar el sobrenombre." };
  revalidatePath("/cobrador/mis-numeros");
  return { ok: true };
}

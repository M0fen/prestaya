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
import { reportarError } from "@/lib/observabilidad";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { registrarMovimientoCaja } from "@/lib/data/caja";
import { getSolicitudGasto } from "@/lib/data/solicitudesGasto";
import { registrarBitacora } from "@/lib/data/bitacora";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { enviarMensajeDb } from "@/lib/data/chat";
import { CATEGORIAS_GASTO, pideComprobante } from "@/lib/gastosRuta";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

type Resultado = { ok: true } | { ok: false; error: string };

const CATEGORIAS = new Set<string>(CATEGORIAS_GASTO);
const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
/** Solo http(s) (la foto la subió `subirComprobanteGasto` a nuestro bucket). */
const esUrlComprobante = (s: string | null | undefined) => /^https?:\/\/\S+$/i.test((s ?? "").trim());

/** Avisa al cobrador, en SU hilo de chat, cómo quedó su solicitud de gasto.
 *  Best-effort: si falla, no rompe la aprobación/rechazo (la plata ya se movió).
 *  Cierra el loop: el cobrador deja de esperar a ciegas parado en la calle. */
async function avisarCobrador(
  admin: ReturnType<typeof createSupabaseAdmin>,
  cobradorId: string,
  adminId: string,
  cuerpo: string,
): Promise<void> {
  try {
    await enviarMensajeDb(admin, {
      ambito: "cobrador",
      cobradorId,
      zonaId: null,
      autorId: adminId,
      cuerpo,
    });
  } catch {
    /* aviso opcional: la resolución del gasto igual quedó registrada */
  }
}

/** (Cobrador) Solicita un gasto de ruta. Queda PENDIENTE de aprobación del admin.
 *  Según la actividad, EXIGE la foto del comprobante/factura (control anti-fraude). */
export async function solicitarGastoRuta(input: {
  monto: number;
  categoria?: string | null;
  descripcion?: string | null;
  comprobanteUrl?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "cobrador") {
    return { ok: false, error: "Solo un cobrador puede solicitar un gasto." };
  }
  const monto = Math.round(Number(input.monto) || 0);
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  const categoria = CATEGORIAS.has(input.categoria ?? "") ? (input.categoria as string) : "Otro";
  const descripcion = (input.descripcion ?? "").trim().slice(0, 160) || null;
  // Comprobante: solo aceptamos una URL de NUESTRO bucket; obligatorio según la
  // actividad (combustible/peaje/otro). Sin foto válida no se puede solicitar.
  const comprobanteUrl = esUrlComprobante(input.comprobanteUrl) ? (input.comprobanteUrl as string).trim() : null;
  if (pideComprobante(categoria) && !comprobanteUrl) {
    return { ok: false, error: "Adjuntá la foto del comprobante o factura para este gasto." };
  }

  try {
    const db = await createSupabaseServer();
    const { error } = await db.from("solicitudes_gasto").insert({
      cobrador_id: usuario.id,
      monto,
      categoria,
      descripcion,
      comprobante_url: comprobanteUrl,
      solicitado_por: usuario.id,
      solicitado_por_nombre: usuario.nombre,
    });
    if (error) return { ok: false, error: "No se pudo enviar la solicitud. ¿Corriste las migraciones 0057 y 0070?" };
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

/** (Cobrador) Sube la FOTO del comprobante/factura de un gasto y devuelve su URL
 *  pública (bucket 'anuncios', service_role). Valida tipo y tamaño. La URL después
 *  viaja en `solicitarGastoRuta`. */
export async function subirComprobanteGasto(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || u.rol !== "cobrador") return { ok: false, error: "Solo un cobrador sube el comprobante." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Elegí una foto." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "La foto es muy grande (máx. 5 MB)." };
  const tipos = ["image/png", "image/jpeg", "image/webp"];
  if (!tipos.includes(file.type)) return { ok: false, error: "Sacá una foto (JPG/PNG/WEBP)." };

  try {
    const admin = createSupabaseAdmin();
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const nombre = `gasto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from("anuncios").upload(nombre, buf, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data } = admin.storage.from("anuncios").getPublicUrl(nombre);
    return { ok: true, url: data.publicUrl };
  } catch {
    return { ok: false, error: "No se pudo subir la foto. Probá de nuevo." };
  }
}

/** (Admin) Aprueba: crea el egreso real y marca la solicitud aprobada. */
export async function aprobarGastoRuta(input: { solicitudId: string }): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || usuario.rol !== "admin") {
    return { ok: false, error: "Solo el administrador aprueba gastos." };
  }
  // Kill switch (modo solo-lectura): aprobar un gasto SACA plata de la caja, así que
  // durante un freeze de emergencia se congela. Rechazar no mueve plata → queda libre.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  const db = await createSupabaseServer();
  const sol = await getSolicitudGasto(db, input.solicitudId);
  if (!sol) return { ok: false, error: "No se encontró la solicitud." };
  if (sol.estado !== "pendiente") return { ok: false, error: "Esa solicitud ya fue resuelta." };

  const admin = createSupabaseAdmin();

  // CANDADO (evita el egreso DUPLICADO por doble clic / retry de red / dos gestores
  // en paralelo): el UPDATE atómico pendiente→aprobada con guardia `.eq('estado',
  // 'pendiente')` hace que SOLO una llamada concurrente gane (devuelve 1 fila). Se
  // ejecuta ANTES de tocar la caja; recién el ganador crea el egreso. El perdedor
  // no mueve plata. (Mismo patrón que liquidarComision: candado antes que caja.)
  const { data: ganada, error: eUpd } = await admin
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
  if (eUpd) return { ok: false, error: "No se pudo aprobar el gasto." };
  if (!ganada || ganada.length === 0) return { ok: false, error: "La solicitud ya había sido resuelta." };

  try {
    // Ganó el candado → recién ahora el gasto es plata real: se crea el egreso a
    // nombre del cobrador (una sola vez, garantizado por el UPDATE de arriba).
    await registrarMovimientoCaja(admin, {
      tipo: "egreso",
      categoria: sol.categoria ?? "Gasto de ruta",
      monto: sol.monto,
      descripcion: sol.descripcion,
      cobradorId: sol.cobradorId,
      registradoPor: usuario.id,
    });
  } catch (e) {
    reportarError("aprobarGastoRuta", e, { solicitudId: sol.id, monto: sol.monto });
    // La caja falló DESPUÉS del candado → revertir a 'pendiente' para no dejar el
    // gasto "aprobado" sin su egreso (si no, quedaría aprobado sin salir de caja).
    await admin
      .from("solicitudes_gasto")
      .update({ estado: "pendiente", resuelto_por: null, resuelto_por_nombre: null, resuelto_en: null })
      .eq("id", sol.id);
    return { ok: false, error: "No se pudo crear el egreso en la caja." };
  }

  await registrarAuditoria(admin, {
    actorId: usuario.id,
    actorNombre: usuario.nombre,
    accion: "Aprobó un gasto de ruta",
    entidad: "gasto",
    entidadId: sol.id,
    detalle: `${sol.cobradorNombre ?? "Cobrador"} · $${sol.monto.toLocaleString("es-UY")} · ${sol.categoria ?? "—"}`,
  });
  // Cierra el loop con el cobrador (deja de esperar a ciegas).
  await avisarCobrador(
    admin,
    sol.cobradorId,
    usuario.id,
    `✅ Aprobé tu gasto de ${money(sol.monto)}${sol.categoria ? ` (${sol.categoria})` : ""}. Ya se descontó de tu caja del día.`,
  );
  revalidatePath("/admin/gastos");
  revalidatePath("/cobrador");
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
  const motivoTxt = (input.motivo ?? "").trim();
  await avisarCobrador(
    admin,
    sol.cobradorId,
    usuario.id,
    `❌ No pude aprobar tu gasto de ${money(sol.monto)}${sol.categoria ? ` (${sol.categoria})` : ""}.${motivoTxt ? ` Motivo: ${motivoTxt}` : ""}`,
  );
  revalidatePath("/admin/gastos");
  revalidatePath("/cobrador");
  return { ok: true };
}

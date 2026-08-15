"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — LEADS de la TIENDA PÚBLICA (0111).
//   · registrarInteresPublico → PÚBLICA (visitante anónimo de /tienda deja su
//     contacto). Validada + rate-limit por IP (anti-spam). Escribe con service_role.
//   · resolverLeadPublico → gestor: marca contactado/cerrado/descartado.
// ─────────────────────────────────────────────────────────────────────────
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  crearLeadPublicoDb,
  crearLeadsPublicosDb,
  resolverLeadPublicoDb,
  ESTADOS_LEAD_PUBLICO,
  type EstadoLeadPublico,
  type NuevoLeadPublico,
} from "@/lib/data/leadsPublicos";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";

/** Folio PY-XXXXXX del comprobante (lo genera la pantalla; acá se sanea). */
function folioSaneado(v: unknown): string | null {
  const f = (v ?? "").toString().trim().toUpperCase().slice(0, 12);
  return /^PY-[A-Z0-9]{4,8}$/.test(f) ? f : null;
}
import { soloDigitos } from "@/lib/telefono";
import { permitir, ipDesdeHeaders } from "@/lib/seguridad/rateLimit";

type Resultado = { ok: true } | { ok: false; error: string };

export async function registrarInteresPublico(input: {
  productoId?: string | null;
  productoNombre?: string | null;
  nombre: string;
  telefono: string;
  mensaje?: string | null;
  cantidad?: number;
  cuotasPreferidas?: number | null;
  folio?: string | null;
  /** Nonce del navegador: el doble tap del mismo interés no duplica (0149). */
  opId?: string | null;
}): Promise<Resultado> {
  const nombre = (input.nombre ?? "").toString().trim().slice(0, 80);
  const tel = (input.telefono ?? "").toString().trim().slice(0, 30);
  if (nombre.length < 2) return { ok: false, error: "Poné tu nombre." };
  if (soloDigitos(tel).length < 6) return { ok: false, error: "Poné un teléfono/WhatsApp válido." };
  // Anti-spam: rate-limit por IP (el endpoint es público/anónimo).
  const ip = ipDesdeHeaders((await headers()) as unknown as Headers);
  if (!(await permitir("tienda_publica", ip))) {
    return { ok: false, error: "Recibimos varios pedidos tuyos. Probá de nuevo en unos minutos." };
  }
  try {
    const db = createSupabaseAdmin();
    const cuotasPref = Math.round(Number(input.cuotasPreferidas));
    await crearLeadPublicoDb(db, {
      productoId: input.productoId && esUuid(input.productoId) ? input.productoId : null,
      productoNombre: (input.productoNombre ?? "").toString().trim().slice(0, 120) || null,
      nombre,
      telefono: tel,
      mensaje: (input.mensaje ?? "").toString().trim().slice(0, 300) || null,
      cantidad: Math.max(1, Math.min(50, Math.round(Number(input.cantidad) || 1))),
      cuotasPreferidas: Number.isFinite(cuotasPref) && cuotasPref >= 1 && cuotasPref <= 1000 ? cuotasPref : null,
      folio: folioSaneado(input.folio),
      opId: input.opId && esUuid(input.opId) ? input.opId : null,
    });
    return { ok: true }; // `duplicado` también es ok: el interés ya quedó registrado
  } catch {
    return { ok: false, error: "No se pudo enviar. Probá de nuevo." };
  }
}

/**
 * Checkout del CARRITO público: un visitante anónimo pide varios productos de una.
 * Crea un lead por ítem (el admin ve cada producto). Validado + rate-limit por IP.
 */
export async function pedirCarritoPublico(input: {
  items: { productoId?: string | null; productoNombre?: string | null; cantidad?: number; cuotasPreferidas?: number | null }[];
  nombre: string;
  telefono: string;
  /** Nonce del pedido (uuid del navegador): el doble tap / reintento no duplica el lote. */
  nonce?: string | null;
  folio?: string | null;
}): Promise<Resultado> {
  const nombre = (input.nombre ?? "").toString().trim().slice(0, 80);
  const tel = (input.telefono ?? "").toString().trim().slice(0, 30);
  if (nombre.length < 2) return { ok: false, error: "Poné tu nombre." };
  if (soloDigitos(tel).length < 6) return { ok: false, error: "Poné un teléfono/WhatsApp válido." };
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) return { ok: false, error: "Tu carrito está vacío." };
  // No truncar en silencio: rechazar si supera el tope (el cliente pediría en dos tandas).
  if (items.length > 20) return { ok: false, error: "Demasiados productos en un pedido (máximo 20). Pedí en dos tandas." };
  const ip = ipDesdeHeaders((await headers()) as unknown as Headers);
  if (!(await permitir("tienda_publica", ip))) {
    return { ok: false, error: "Recibimos varios pedidos tuyos. Probá de nuevo en unos minutos." };
  }
  try {
    const db = createSupabaseAdmin();
    const nonce = input.nonce && esUuid(input.nonce) ? input.nonce : null;
    const folio = folioSaneado(input.folio);
    // UN insert atómico (antes: loop ítem por ítem — un fallo en el 3º dejaba
    // media compra hecha y el reintento del visitante duplicaba los primeros).
    const filas: NuevoLeadPublico[] = items.map((it, i) => {
      const cant = Math.max(1, Math.min(50, Math.round(Number(it.cantidad) || 1)));
      const cuotasPref = Math.round(Number(it.cuotasPreferidas));
      return {
        productoId: it.productoId && esUuid(it.productoId) ? it.productoId : null,
        productoNombre: (it.productoNombre ?? "").toString().trim().slice(0, 120) || null,
        nombre,
        telefono: tel,
        mensaje: `🛒 Pedido del carrito (${i + 1}/${items.length})${cant > 1 ? ` · x${cant}` : ""}`,
        cantidad: cant,
        cuotasPreferidas: Number.isFinite(cuotasPref) && cuotasPref >= 1 && cuotasPref <= 1000 ? cuotasPref : null,
        folio,
        // Determinista por (nonce, ítem): el reintento del MISMO pedido rebota.
        opId: nonce ? opIdDeterminista("lead-publico", `${nonce}:${i}`) : null,
      };
    });
    await crearLeadsPublicosDb(db, filas);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo enviar el pedido. Probá de nuevo." };
  }
}

export async function resolverLeadPublico(input: { id: string; estado: string }): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(input.id) || !ESTADOS_LEAD_PUBLICO.includes(input.estado as EstadoLeadPublico)) {
    return { ok: false, error: "Datos inválidos." };
  }
  try {
    const db = createSupabaseAdmin();
    await resolverLeadPublicoDb(db, input.id, input.estado as EstadoLeadPublico, u.id, new Date().toISOString());
    revalidatePath("/admin/tienda");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo actualizar." };
  }
}

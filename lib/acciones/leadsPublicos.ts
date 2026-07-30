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
  resolverLeadPublicoDb,
  ESTADOS_LEAD_PUBLICO,
  type EstadoLeadPublico,
} from "@/lib/data/leadsPublicos";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { esUuid } from "@/lib/idempotencia";
import { soloDigitos } from "@/lib/telefono";
import { permitir, ipDesdeHeaders } from "@/lib/seguridad/rateLimit";

type Resultado = { ok: true } | { ok: false; error: string };

export async function registrarInteresPublico(input: {
  productoId?: string | null;
  productoNombre?: string | null;
  nombre: string;
  telefono: string;
  mensaje?: string | null;
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
    await crearLeadPublicoDb(db, {
      productoId: input.productoId && esUuid(input.productoId) ? input.productoId : null,
      productoNombre: (input.productoNombre ?? "").toString().trim().slice(0, 120) || null,
      nombre,
      telefono: tel,
      mensaje: (input.mensaje ?? "").toString().trim().slice(0, 300) || null,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo enviar. Probá de nuevo." };
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

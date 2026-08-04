"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — JUEGOS PROMOCIONALES (admin). Configurar premios de la
//  raspadita (con sus pesos/probabilidades) y abrir/cerrar quinielas.
//  ⚠️ PROMOCIONAL: premios = beneficios simbólicos, NUNCA dinero (ver 0021).
//  Solo gestores. Queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin, esGestor } from "@/lib/auth";
import {
  guardarPremioRaspaDb,
  borrarPremioRaspaDb,
  guardarSegmentoRaspaDb,
  borrarSegmentoRaspaDb,
  crearQuinielaDb,
  cerrarQuinielaDb,
  getParticipaciones,
  getJugadaPorFolio,
  canjearFolioDb,
  otorgarRaspaditasDb,
  type ComprobanteRaspa,
} from "@/lib/data/promos";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { esUuid } from "@/lib/idempotencia";
import { normalizarNumero } from "@/lib/quiniela";
import { normalizarSegmento, esSegmentoTodos, type DefinicionSegmento } from "@/lib/segmentos";
import { UYU } from "@/lib/format";

type Resultado = { ok: true } | { ok: false; error: string };

// ── Comprobante de premio: validar + canjear (la oficina valida un folio) ───
export async function validarComprobanteAction(
  folio: number,
): Promise<{ ok: true; comprobante: ComprobanteRaspa | null } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const f = Math.round(Number(folio) || 0);
  if (!(f > 0)) return { ok: false, error: "Poné un número de folio válido." };
  try {
    const db = await createSupabaseServer();
    return { ok: true, comprobante: await getJugadaPorFolio(db, f) };
  } catch {
    return { ok: false, error: "No se pudo consultar. Probá de nuevo." };
  }
}

export async function canjearComprobanteAction(
  folio: number,
): Promise<{ ok: true; estado: "canjeado" | "ya-estaba" | "no-existe" } | { ok: false; error: string }> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const f = Math.round(Number(folio) || 0);
  if (!(f > 0)) return { ok: false, error: "Folio inválido." };
  try {
    const db = await createSupabaseServer();
    const r = await canjearFolioDb(db, f, u.id);
    if (r.estado === "canjeado") {
      await registrarAuditoria(db, {
        actorId: u.id, actorNombre: u.nombre,
        accion: "Canjeó un comprobante de raspadita",
        entidad: "promo", detalle: `Folio ${String(f).padStart(6, "0")}`,
      });
      revalidatePath("/admin/promos");
    }
    return { ok: true, estado: r.estado };
  } catch {
    return { ok: false, error: "No se pudo canjear. Probá de nuevo." };
  }
}

export async function otorgarRaspaditasAction(input: {
  clienteId: string;
  cantidad: number;
  motivo?: string | null;
  /** Premio FIJADO (0103): si viene, esas raspaditas entregan ESE premio (no el
   *  azar). null/ausente = azar por scoring, como siempre. */
  premioId?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  if (!esUuid(input.clienteId)) return { ok: false, error: "Cliente inválido." };
  const cantidad = Math.max(1, Math.min(50, Math.round(Number(input.cantidad) || 0)));
  const motivo = (input.motivo ?? "").trim().slice(0, 120) || null;
  const premioId = esUuid(input.premioId) ? input.premioId : null;
  try {
    const db = await createSupabaseServer();
    await otorgarRaspaditasDb(db, { clienteId: input.clienteId, cantidad, motivo, otorgadoPor: u.id, premioId });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Otorgó raspaditas a un cliente",
      entidad: "promo",
      detalle: `${cantidad} raspadita(s)${premioId ? " · premio fijado" : ""}${motivo ? ` · ${motivo}` : ""}`,
    });
    revalidatePath(`/admin/clientes/${input.clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo otorgar. Probá de nuevo." };
  }
}

async function gestor() {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esAdmin(u.rol)) return null;
  return u;
}

// ── Raspadita: premios ─────────────────────────────────────────────────────
export async function guardarPremioRaspa(input: {
  id?: string | null;
  label: string;
  tipo: string;
  peso: number;
  activo: boolean;
  orden: number;
  segmentoId?: string | null;
  /** Cuánto le cuesta a la empresa entregar este premio (0130). */
  costo?: number;
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const label = (input.label ?? "").trim().slice(0, 60);
  if (!label) return { ok: false, error: "Poné un texto para el premio." };
  const tipo = input.tipo === "beneficio" ? "beneficio" : "nada";
  // Un premio "nada" no cuesta: su costo se fuerza a 0 para que no ensucie la
  // proyección (no participa de la ruleta de premios).
  const costo =
    tipo === "nada" ? 0 : Math.max(0, Math.min(10_000_000, Math.round(Number(input.costo) || 0)));
  try {
    const db = await createSupabaseServer();
    await guardarPremioRaspaDb(db, {
      id: input.id ?? null,
      label,
      tipo,
      peso: Math.max(0, Math.min(1000, Math.round(Number(input.peso) || 0))),
      activo: Boolean(input.activo),
      orden: Math.round(Number(input.orden) || 0),
      segmentoId: input.segmentoId === undefined ? undefined : (input.segmentoId || null),
      costo,
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: input.id ? "Editó premio de raspadita" : "Creó premio de raspadita",
      entidad: "promo", detalle: `${label} (${tipo}) · costo ${UYU(costo)}`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

// ── Raspadita: TRAMOS de scoring (0042) ─────────────────────────────────────
export async function guardarSegmentoRaspa(input: {
  id?: string | null;
  nombre: string;
  scoreMin: number;
  scoreMax: number;
  probGanar: number;
  activo: boolean;
  orden: number;
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const nombre = (input.nombre ?? "").trim().slice(0, 60);
  if (!nombre) return { ok: false, error: "Poné un nombre para el tramo." };
  // Clamp/orden de los límites (0..100) y probabilidad (0..100).
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  let min = clamp(input.scoreMin);
  let max = clamp(input.scoreMax);
  if (min > max) [min, max] = [max, min];
  try {
    const db = await createSupabaseServer();
    await guardarSegmentoRaspaDb(db, {
      id: input.id ?? null,
      nombre,
      scoreMin: min,
      scoreMax: max,
      probGanar: clamp(input.probGanar),
      activo: Boolean(input.activo),
      orden: Math.round(Number(input.orden) || 0),
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: input.id ? "Editó tramo de raspadita" : "Creó tramo de raspadita",
      entidad: "promo", detalle: `${nombre} (${min}–${max}% · gana ${clamp(input.probGanar)}%)`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
}

export async function eliminarSegmentoRaspa(id: string): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await borrarSegmentoRaspaDb(db, id);
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar (el tramo 'Los demás' no se puede eliminar)." };
  }
}

export async function eliminarPremioRaspa(id: string): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  try {
    const db = await createSupabaseServer();
    await borrarPremioRaspaDb(db, id);
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar." };
  }
}

// ── Quiniela ───────────────────────────────────────────────────────────────
export async function crearQuiniela(input: {
  titulo: string;
  rangoMin: number;
  rangoMax: number;
  premioTexto: string;
  /** Audiencia (0089): solo estos clientes participan. null/vacío = todos los al día. */
  segmentoDef?: DefinicionSegmento | null;
  /** Cuánto cuesta el premio de esta quiniela (0130). Entra al presupuesto. */
  costoPremio?: number;
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const titulo = (input.titulo ?? "").trim().slice(0, 80);
  const premioTexto = (input.premioTexto ?? "").trim().slice(0, 120);
  if (!titulo || !premioTexto) return { ok: false, error: "Completá título y premio." };
  const min = Math.max(0, Math.round(Number(input.rangoMin) || 0));
  const max = Math.max(min + 1, Math.round(Number(input.rangoMax) || 99));
  const costoPremio = Math.max(0, Math.min(10_000_000, Math.round(Number(input.costoPremio) || 0)));
  const defRaw = normalizarSegmento(input.segmentoDef ?? {});
  const segmentoDef = esSegmentoTodos(defRaw) ? null : defRaw;
  try {
    const db = await createSupabaseServer();
    await crearQuinielaDb(db, { titulo, rangoMin: min, rangoMax: max, premioTexto, segmentoDef, costoPremio });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Abrió quiniela", entidad: "promo",
      detalle: `${titulo} (${min}–${max}) · premio ${UYU(costoPremio)}`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo crear. Probá de nuevo." };
  }
}

export async function cerrarQuiniela(input: {
  id: string;
  rangoMin: number;
  rangoMax: number;
  numeroGanador: number;
  /** cliente_ids que el admin FUERZA como ganadores, además del número (0090). */
  forzados?: string[];
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const numero = normalizarNumero(input.numeroGanador, { min: input.rangoMin, max: input.rangoMax });
  try {
    const db = await createSupabaseServer();
    // Solo se puede forzar a quien REALMENTE participó (no se premia a quien no jugó).
    // Se intersecta contra las participaciones reales antes de guardar.
    let forzados: string[] = [];
    const pedidos = [...new Set((input.forzados ?? []).filter((s) => typeof s === "string" && s))];
    if (pedidos.length > 0) {
      const parts = await getParticipaciones(db, input.id);
      const participantes = new Set(parts.map((p) => p.clienteId));
      forzados = pedidos.filter((id) => participantes.has(id));
    }
    await cerrarQuinielaDb(db, input.id, numero, forzados);
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Cerró quiniela (sorteo)", entidad: "promo", entidadId: input.id,
      detalle: `Número ganador: ${numero}${forzados.length ? ` · ${forzados.length} ganador(es) forzado(s)` : ""}`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo cerrar." };
  }
}

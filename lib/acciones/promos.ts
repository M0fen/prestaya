"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions — JUEGOS PROMOCIONALES (admin). Configurar premios de la
//  raspadita (con sus pesos/probabilidades) y abrir/cerrar quinielas.
//  ⚠️ PROMOCIONAL: premios = beneficios simbólicos, NUNCA dinero (ver 0021).
//  Solo gestores. Queda en auditoría.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esAdmin } from "@/lib/auth";
import {
  guardarPremioRaspaDb,
  borrarPremioRaspaDb,
  guardarSegmentoRaspaDb,
  borrarSegmentoRaspaDb,
  crearQuinielaDb,
  cerrarQuinielaDb,
} from "@/lib/data/promos";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { normalizarNumero } from "@/lib/quiniela";

type Resultado = { ok: true } | { ok: false; error: string };

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
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const label = (input.label ?? "").trim().slice(0, 60);
  if (!label) return { ok: false, error: "Poné un texto para el premio." };
  const tipo = input.tipo === "beneficio" ? "beneficio" : "nada";
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
    });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: input.id ? "Editó premio de raspadita" : "Creó premio de raspadita",
      entidad: "promo", detalle: `${label} (${tipo})`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0021?" };
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
    return { ok: false, error: "No se pudo guardar. ¿Corriste la migración 0042?" };
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
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const titulo = (input.titulo ?? "").trim().slice(0, 80);
  const premioTexto = (input.premioTexto ?? "").trim().slice(0, 120);
  if (!titulo || !premioTexto) return { ok: false, error: "Completá título y premio." };
  const min = Math.max(0, Math.round(Number(input.rangoMin) || 0));
  const max = Math.max(min + 1, Math.round(Number(input.rangoMax) || 99));
  try {
    const db = await createSupabaseServer();
    await crearQuinielaDb(db, { titulo, rangoMin: min, rangoMax: max, premioTexto });
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Abrió quiniela", entidad: "promo", detalle: `${titulo} (${min}–${max})`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo crear. ¿Corriste la migración 0021?" };
  }
}

export async function cerrarQuiniela(input: {
  id: string;
  rangoMin: number;
  rangoMax: number;
  numeroGanador: number;
}): Promise<Resultado> {
  const u = await gestor();
  if (!u) return { ok: false, error: "No tenés permisos." };
  const numero = normalizarNumero(input.numeroGanador, { min: input.rangoMin, max: input.rangoMax });
  try {
    const db = await createSupabaseServer();
    await cerrarQuinielaDb(db, input.id, numero);
    await registrarAuditoria(db, {
      actorId: u.id, actorNombre: u.nombre,
      accion: "Cerró quiniela (sorteo)", entidad: "promo", entidadId: input.id,
      detalle: `Número ganador: ${numero}`,
    });
    revalidatePath("/admin/promos");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo cerrar." };
  }
}

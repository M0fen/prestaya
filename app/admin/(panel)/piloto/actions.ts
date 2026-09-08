"use server";
// Acciones del panel del piloto (solo dev): crear y mover pendientes. Cada
// cambio deja rastro (quién, cuándo, nota) en el propio pendiente.
import { revalidatePath } from "next/cache";
import { requireDev } from "@/lib/auth";
import {
  cambiarEstadoPendiente,
  crearPendiente,
  editarPendiente,
  CATEGORIAS,
  DUENOS,
  ESTADOS,
  PRIORIDADES,
  type CategoriaPendiente,
  type DuenoPendiente,
  type EstadoPendiente,
  type PrioridadPendiente,
} from "@/lib/data/pilotoPendientes";

export type ResultadoPendiente = { ok: true } | { ok: false; error: string };

const montoDe = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export async function crearPendienteAction(fd: FormData): Promise<ResultadoPendiente> {
  try {
    const u = await requireDev();
    const titulo = String(fd.get("titulo") ?? "").trim();
    if (titulo.length < 4) return { ok: false, error: "Escribí un título." };
    const dueno = String(fd.get("dueno") ?? "carlos") as DuenoPendiente;
    const categoria = String(fd.get("categoria") ?? "datos") as CategoriaPendiente;
    const prioridad = String(fd.get("prioridad") ?? "media") as PrioridadPendiente;
    if (!DUENOS.includes(dueno) || !CATEGORIAS.includes(categoria) || !PRIORIDADES.includes(prioridad)) {
      return { ok: false, error: "Valor inválido." };
    }
    await crearPendiente(
      {
        titulo,
        detalle: String(fd.get("detalle") ?? "") || null,
        dueno,
        categoria,
        prioridad,
        monto: montoDe(fd.get("monto")),
        origen: String(fd.get("origen") ?? "") || "panel",
      },
      { id: u.id, nombre: u.nombre },
    );
    revalidatePath("/admin/piloto");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo crear." };
  }
}

export async function moverPendienteAction(id: string, estado: EstadoPendiente, nota: string): Promise<ResultadoPendiente> {
  try {
    const u = await requireDev();
    if (!ESTADOS.includes(estado)) return { ok: false, error: "Estado inválido." };
    if ((estado === "resuelto" || estado === "aceptado") && nota.trim().length < 3) {
      return { ok: false, error: "Para cerrar un pendiente hace falta una nota (qué se decidió)." };
    }
    await cambiarEstadoPendiente(id, estado, nota, { id: u.id, nombre: u.nombre });
    revalidatePath("/admin/piloto");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo mover." };
  }
}

export async function editarPendienteAction(
  id: string,
  campos: { titulo?: string; detalle?: string | null; dueno?: DuenoPendiente; categoria?: CategoriaPendiente; prioridad?: PrioridadPendiente; monto?: number | null },
): Promise<ResultadoPendiente> {
  try {
    await requireDev();
    if (campos.dueno && !DUENOS.includes(campos.dueno)) return { ok: false, error: "Dueño inválido." };
    if (campos.categoria && !CATEGORIAS.includes(campos.categoria)) return { ok: false, error: "Categoría inválida." };
    if (campos.prioridad && !PRIORIDADES.includes(campos.prioridad)) return { ok: false, error: "Prioridad inválida." };
    await editarPendiente(id, campos);
    revalidatePath("/admin/piloto");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo editar." };
  }
}

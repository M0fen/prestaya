"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Actions de NOTAS: por cliente (equipo) y personales (privadas).
//  Corren con la sesión del usuario → el RLS de 0007 valida el acceso.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import {
  crearNotaClienteDb,
  borrarNotaClienteDb,
  crearNotaPersonalDb,
  borrarNotaPersonalDb,
} from "@/lib/data/notas";

type Resultado = { ok: true } | { ok: false; error: string };

function validar(cuerpo: string, max: number): string | null {
  const t = (cuerpo ?? "").trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

export async function agregarNotaCliente(input: {
  clienteId: string;
  cuerpo: string;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  const cuerpo = validar(input.cuerpo, 2000);
  if (!cuerpo) return { ok: false, error: "Escribí la nota." };
  try {
    const db = await createSupabaseServer();
    await crearNotaClienteDb(db, { clienteId: input.clienteId, autorId: usuario.id, cuerpo });
    revalidatePath(`/cobrador/cliente/${input.clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar la nota." };
  }
}

export async function borrarNotaCliente(input: {
  id: string;
  clienteId: string;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  try {
    const db = await createSupabaseServer();
    await borrarNotaClienteDb(db, input.id);
    revalidatePath(`/cobrador/cliente/${input.clienteId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar." };
  }
}

export async function agregarNotaPersonal(input: { cuerpo: string }): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  const cuerpo = validar(input.cuerpo, 4000);
  if (!cuerpo) return { ok: false, error: "Escribí la nota." };
  try {
    const db = await createSupabaseServer();
    await crearNotaPersonalDb(db, { usuarioId: usuario.id, cuerpo });
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar la nota." };
  }
}

export async function borrarNotaPersonal(input: { id: string }): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  try {
    const db = await createSupabaseServer();
    await borrarNotaPersonalDb(db, input.id);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo borrar." };
  }
}

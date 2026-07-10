"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — cargar la FICHA RÁPIDA de un cliente (modal "ojito").
//  Gatea: solo gestores; el supervisor solo ve clientes de SU zona.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { getFichaRapida, type FichaRapida } from "@/lib/data/fichaRapida";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoFicha = { ok: true; ficha: FichaRapida } | { ok: false; error: string };

export async function cargarFichaRapida(clienteId: string): Promise<ResultadoFicha> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No autorizado." };
  if (!ES_UUID.test(clienteId ?? "")) return { ok: false, error: "Cliente inválido." };

  // El supervisor solo puede espiar clientes de su zona.
  const alcance = await alcanceDelActor();
  if (!alcance.global && !alcance.clienteIds.includes(clienteId)) {
    return { ok: false, error: "Ese cliente no es de tu zona." };
  }

  const db = await createSupabaseServer();
  const ficha = await getFichaRapida(db, clienteId);
  if (!ficha) return { ok: false, error: "Cliente no encontrado." };
  return { ok: true, ficha };
}

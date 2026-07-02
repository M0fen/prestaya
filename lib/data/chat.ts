// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CHAT interno (comunicación de la operación).
//  Dos ámbitos: 'general' (hilo del equipo) y 'cobrador' (hilo gestor ↔ un
//  cobrador). Todo por RLS: cada quien ve/escribe solo sus canales. Ver 0007.
//  Si la migración 0007 aún no corrió, las lecturas degradan a vacío (la app
//  no se rompe): se detecta el error 42P01 (tabla inexistente).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmbitoMensaje, Mensaje, Usuario } from "@/types/db";
import { cifrar, descifrar } from "@/lib/cripto";
import { tablaFaltante } from "./errores";

/** Clave estable de canal para las lecturas (badge de no leídos). */
export const CANAL_GENERAL = "general";
export const canalCobrador = (cobradorId: string): string => `cob:${cobradorId}`;

export interface Canal {
  /** 'general' | 'cob:<id>' */
  key: string;
  ambito: AmbitoMensaje;
  cobradorId: string | null;
  titulo: string;
  noLeidos: number;
}

export interface MensajeVista extends Mensaje {
  autorNombre: string;
  esMio: boolean;
}

function mapMensaje(r: Record<string, unknown>): Mensaje {
  return {
    id: r.id as string,
    ambito: r.ambito as AmbitoMensaje,
    cobrador_id: (r.cobrador_id as string | null) ?? null,
    autor_id: r.autor_id as string,
    // El cuerpo se guarda cifrado (AES-256-GCM); se descifra al leer.
    cuerpo: descifrar(r.cuerpo as string),
    creado_en: r.creado_en as string,
  };
}

/** Mensajes de un canal, del más viejo al más nuevo (para leer de arriba abajo). */
export async function getMensajes(
  db: SupabaseClient,
  ambito: AmbitoMensaje,
  cobradorId: string | null,
  limite = 200,
): Promise<Mensaje[]> {
  try {
    let q = db.from("mensajes").select("*").eq("ambito", ambito);
    q = ambito === "cobrador" ? q.eq("cobrador_id", cobradorId) : q.is("cobrador_id", null);
    const { data, error } = await q.order("creado_en", { ascending: true }).limit(limite);
    if (error) throw error;
    return (data ?? []).map(mapMensaje);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** Enriquece mensajes con nombre de autor y "esMío" (para pintar burbujas). */
export async function getMensajesVista(
  db: SupabaseClient,
  ambito: AmbitoMensaje,
  cobradorId: string | null,
  yoId: string,
): Promise<MensajeVista[]> {
  const mensajes = await getMensajes(db, ambito, cobradorId);
  const autorIds = [...new Set(mensajes.map((m) => m.autor_id))];
  const nombres = new Map<string, string>();
  if (autorIds.length > 0) {
    const { data } = await db.from("usuarios").select("id, nombre").in("id", autorIds);
    for (const u of data ?? []) nombres.set(u.id as string, u.nombre as string);
  }
  return mensajes.map((m) => ({
    ...m,
    autorNombre: nombres.get(m.autor_id) ?? "—",
    esMio: m.autor_id === yoId,
  }));
}

/** Inserta un mensaje. El RLS valida canal + que el autor sea uno mismo. */
export async function enviarMensajeDb(
  db: SupabaseClient,
  input: { ambito: AmbitoMensaje; cobradorId: string | null; autorId: string; cuerpo: string },
): Promise<void> {
  const { error } = await db.from("mensajes").insert({
    ambito: input.ambito,
    cobrador_id: input.ambito === "cobrador" ? input.cobradorId : null,
    autor_id: input.autorId,
    cuerpo: cifrar(input.cuerpo), // en reposo queda cifrado
  });
  if (error) throw error;
}

/** Cuenta no leídos de un canal: mensajes de otros posteriores a mi última lectura. */
async function contarNoLeidos(
  db: SupabaseClient,
  ambito: AmbitoMensaje,
  cobradorId: string | null,
  yoId: string,
  desde: string,
): Promise<number> {
  let q = db
    .from("mensajes")
    .select("*", { count: "exact", head: true })
    .eq("ambito", ambito)
    .gt("creado_en", desde)
    .neq("autor_id", yoId);
  q = ambito === "cobrador" ? q.eq("cobrador_id", cobradorId) : q.is("cobrador_id", null);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

const EPOCA = "1970-01-01T00:00:00Z";

/**
 * Canales visibles para el usuario, con su conteo de no leídos.
 * Gestor: general + un hilo por cada cobrador activo. Cobrador: general + el
 * suyo. Degrada a solo "general" (0 no leídos) si 0007 no corrió.
 */
export async function getCanales(
  db: SupabaseClient,
  usuario: Usuario,
): Promise<Canal[]> {
  try {
    const esGestor = usuario.rol === "admin" || usuario.rol === "supervisor";

    // Lista de canales (sin conteos todavía).
    const base: Omit<Canal, "noLeidos">[] = [
      { key: CANAL_GENERAL, ambito: "general", cobradorId: null, titulo: "Equipo" },
    ];
    if (esGestor) {
      const { data: cobs } = await db
        .from("usuarios")
        .select("id, nombre")
        .eq("rol", "cobrador")
        .eq("activo", true)
        .order("nombre");
      for (const c of cobs ?? [])
        base.push({
          key: canalCobrador(c.id as string),
          ambito: "cobrador",
          cobradorId: c.id as string,
          titulo: c.nombre as string,
        });
    } else {
      base.push({
        key: canalCobrador(usuario.id),
        ambito: "cobrador",
        cobradorId: usuario.id,
        titulo: "Oficina",
      });
    }

    // Última lectura por canal.
    const { data: lecturas } = await db
      .from("chat_lecturas")
      .select("canal, ultima_lectura")
      .eq("usuario_id", usuario.id);
    const leido = new Map<string, string>();
    for (const l of lecturas ?? []) leido.set(l.canal as string, l.ultima_lectura as string);

    // Conteos en paralelo.
    const noLeidos = await Promise.all(
      base.map((c) =>
        contarNoLeidos(db, c.ambito, c.cobradorId, usuario.id, leido.get(c.key) ?? EPOCA),
      ),
    );
    return base.map((c, i) => ({ ...c, noLeidos: noLeidos[i] }));
  } catch (e) {
    if (tablaFaltante(e))
      return [{ key: CANAL_GENERAL, ambito: "general", cobradorId: null, titulo: "Equipo", noLeidos: 0 }];
    throw e;
  }
}

/** Total de no leídos (para el badge del nav). Nunca rompe: 0 si falla. */
export async function getTotalNoLeidos(db: SupabaseClient, usuario: Usuario): Promise<number> {
  try {
    const canales = await getCanales(db, usuario);
    return canales.reduce((s, c) => s + c.noLeidos, 0);
  } catch {
    return 0;
  }
}

/** Borra TODOS los mensajes de un canal (acción de admin). Irreversible.
 *  Pensado para correr con service_role desde una acción admin-gated. */
export async function borrarMensajesCanal(
  db: SupabaseClient,
  ambito: AmbitoMensaje,
  cobradorId: string | null,
): Promise<void> {
  let q = db.from("mensajes").delete().eq("ambito", ambito);
  q = ambito === "cobrador" ? q.eq("cobrador_id", cobradorId) : q.is("cobrador_id", null);
  const { error } = await q;
  if (error && !tablaFaltante(error)) throw error;
}

/** Marca un canal como leído hasta ahora (upsert). */
export async function marcarLeidoDb(
  db: SupabaseClient,
  usuarioId: string,
  canalKey: string,
): Promise<void> {
  const { error } = await db.from("chat_lecturas").upsert(
    { usuario_id: usuarioId, canal: canalKey, ultima_lectura: new Date().toISOString() },
    { onConflict: "usuario_id,canal" },
  );
  if (error && !tablaFaltante(error)) throw error;
}

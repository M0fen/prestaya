// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CHAT interno (comunicación de la operación).
//  Canales: 'general' (equipo), 'cobrador' (gestor ↔ un cobrador), y de GRUPO
//  derivados de zona: 'supervisores' (mandos) y 'zona' (admin + supervisor(es)
//  + cobradores de esa zona). Todo por RLS: cada quien ve/escribe solo sus
//  canales (ver 0007/0033). Si la migración aún no corrió, degrada a vacío.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmbitoMensaje, Mensaje, Usuario } from "@/types/db";
import { cifrar, descifrar } from "@/lib/cripto";
import { tablaFaltante } from "./errores";
import { getZonas, getZonasDeSupervisor } from "./zonas";

/** Claves estables de canal para las lecturas (badge de no leídos). */
export const CANAL_GENERAL = "general";
export const CANAL_SUPERVISORES = "supervisores";
export const canalCobrador = (cobradorId: string): string => `cob:${cobradorId}`;
export const canalZona = (zonaId: string): string => `zona:${zonaId}`;

export interface Canal {
  /** 'general' | 'supervisores' | 'cob:<id>' | 'zona:<id>' */
  key: string;
  ambito: AmbitoMensaje;
  cobradorId: string | null;
  zonaId: string | null;
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
    zona_id: (r.zona_id as string | null) ?? null,
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
  zonaId: string | null,
  limite = 200,
): Promise<Mensaje[]> {
  try {
    const base = db.from("mensajes").select("*").eq("ambito", ambito);
    // 'cobrador' cuelga de cobrador_id; 'zona' de zona_id; el resto de ninguno.
    const q =
      ambito === "cobrador"
        ? base.eq("cobrador_id", cobradorId ?? "")
        : ambito === "zona"
          ? base.eq("zona_id", zonaId ?? "")
          : base.is("cobrador_id", null);
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
  zonaId: string | null,
  yoId: string,
): Promise<MensajeVista[]> {
  const mensajes = await getMensajes(db, ambito, cobradorId, zonaId);
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
  input: {
    ambito: AmbitoMensaje;
    cobradorId: string | null;
    zonaId: string | null;
    autorId: string;
    cuerpo: string;
  },
): Promise<void> {
  const { error } = await db.from("mensajes").insert({
    ambito: input.ambito,
    cobrador_id: input.ambito === "cobrador" ? input.cobradorId : null,
    zona_id: input.ambito === "zona" ? input.zonaId : null,
    autor_id: input.autorId,
    cuerpo: cifrar(input.cuerpo), // en reposo queda cifrado
  });
  if (error) throw error;
}

/** Clave de canal a la que pertenece un mensaje (para bucketizar no-leídos). */
function canalDeMensaje(
  ambito: AmbitoMensaje,
  cobradorId: string | null,
  zonaId: string | null,
): string {
  if (ambito === "cobrador" && cobradorId) return canalCobrador(cobradorId);
  if (ambito === "zona" && zonaId) return canalZona(zonaId);
  if (ambito === "supervisores") return CANAL_SUPERVISORES;
  return CANAL_GENERAL;
}

const EPOCA = "1970-01-01T00:00:00Z";

/**
 * No-leídos por canal en UNA sola query (antes: un `count` por canal → ~50
 * queries por carga con muchos cobradores = N+1). Trae los mensajes visibles
 * (RLS ya acota a los canales del usuario) de OTROS, y los bucketiza contra la
 * última lectura de cada canal. `limit` acota a los más recientes (los no-leídos
 * SIEMPRE lo son). Devuelve un Map canalKey → conteo.
 */
async function noLeidosPorCanal(
  db: SupabaseClient,
  yoId: string,
  leido: Map<string, string>,
): Promise<Map<string, number>> {
  const conteo = new Map<string, number>();
  const { data, error } = await db
    .from("mensajes")
    .select("ambito, cobrador_id, zona_id, creado_en")
    .neq("autor_id", yoId)
    .order("creado_en", { ascending: false })
    .limit(1000);
  if (error) throw error;
  for (const m of data ?? []) {
    const key = canalDeMensaje(m.ambito as AmbitoMensaje, (m.cobrador_id as string | null) ?? null, (m.zona_id as string | null) ?? null);
    if ((m.creado_en as string) > (leido.get(key) ?? EPOCA)) conteo.set(key, (conteo.get(key) ?? 0) + 1);
  }
  return conteo;
}

/**
 * Canales visibles para el usuario, con su conteo de no leídos.
 *  · general: todos. · supervisores: gestores. · zona: admin (todas),
 *    supervisor (las que cubre), cobrador (la suya). · cobrador: gestor ve los
 *    hilos de sus cobradores (por zona); el cobrador ve el suyo ("Oficina").
 * Degrada a solo "general" si 0007 no corrió.
 */
export async function getCanales(db: SupabaseClient, usuario: Usuario): Promise<Canal[]> {
  try {
    const esGestor = usuario.rol === "admin" || usuario.rol === "supervisor";
    const base: Omit<Canal, "noLeidos">[] = [
      { key: CANAL_GENERAL, ambito: "general", cobradorId: null, zonaId: null, titulo: "Equipo" },
    ];

    // Canal de mandos.
    if (esGestor)
      base.push({
        key: CANAL_SUPERVISORES,
        ambito: "supervisores",
        cobradorId: null,
        zonaId: null,
        titulo: "Supervisores",
      });

    // Zonas que supervisa (una sola query, reusada abajo para filtrar cobradores).
    const zonasSup = usuario.rol === "supervisor" ? await getZonasDeSupervisor(db, usuario.id) : [];

    // Canales de zona.
    const zonas = await getZonas(db);
    const nombreZona = new Map(zonas.map((z) => [z.id, z.nombre] as const));
    let zonasVisibles: string[] = [];
    if (usuario.rol === "admin") zonasVisibles = zonas.map((z) => z.id);
    else if (usuario.rol === "supervisor")
      zonasVisibles = zonasSup.length > 0 ? zonasSup : zonas.map((z) => z.id); // fallback: sin zonas ve todas
    else if (usuario.zona_id) zonasVisibles = [usuario.zona_id];

    for (const zid of zonasVisibles) {
      const nombre = nombreZona.get(zid);
      if (!nombre) continue;
      base.push({
        key: canalZona(zid),
        ambito: "zona",
        cobradorId: null,
        zonaId: zid,
        titulo: `Zona ${nombre}`,
      });
    }

    // Hilos por cobrador.
    if (esGestor) {
      const { data: cobs } = await db
        .from("usuarios")
        .select("id, nombre, zona_id")
        .eq("rol", "cobrador")
        .eq("activo", true)
        .order("nombre");
      let lista = (cobs ?? []) as { id: string; nombre: string; zona_id: string | null }[];
      // El supervisor con zonas ve solo los hilos de SUS cobradores.
      if (usuario.rol === "supervisor" && zonasSup.length > 0)
        lista = lista.filter((c) => c.zona_id != null && zonasSup.includes(c.zona_id));
      for (const c of lista)
        base.push({
          key: canalCobrador(c.id),
          ambito: "cobrador",
          cobradorId: c.id,
          zonaId: null,
          titulo: c.nombre,
        });
    } else {
      base.push({
        key: canalCobrador(usuario.id),
        ambito: "cobrador",
        cobradorId: usuario.id,
        zonaId: null,
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

    // No-leídos por canal en UNA query (antes: un count por canal → N+1).
    const conteo = await noLeidosPorCanal(db, usuario.id, leido);
    return base.map((c) => ({ ...c, noLeidos: conteo.get(c.key) ?? 0 }));
  } catch (e) {
    if (tablaFaltante(e))
      return [
        { key: CANAL_GENERAL, ambito: "general", cobradorId: null, zonaId: null, titulo: "Equipo", noLeidos: 0 },
      ];
    throw e;
  }
}

/** Total de no leídos (para el badge del nav, en CADA página). Nunca rompe: 0 si
 *  falla. Ruta caliente → NO enumera canales: solo 2 queries (lecturas + mensajes)
 *  y bucketiza. Antes pasaba por getCanales (~50 counts con muchos cobradores). */
export async function getTotalNoLeidos(db: SupabaseClient, usuario: Usuario): Promise<number> {
  try {
    const { data: lecturas, error } = await db
      .from("chat_lecturas")
      .select("canal, ultima_lectura")
      .eq("usuario_id", usuario.id);
    if (error) throw error;
    const leido = new Map<string, string>();
    for (const l of lecturas ?? []) leido.set(l.canal as string, l.ultima_lectura as string);
    const conteo = await noLeidosPorCanal(db, usuario.id, leido);
    let total = 0;
    for (const n of conteo.values()) total += n;
    return total;
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
  zonaId: string | null,
): Promise<void> {
  const base = db.from("mensajes").delete().eq("ambito", ambito);
  const q =
    ambito === "cobrador"
      ? base.eq("cobrador_id", cobradorId ?? "")
      : ambito === "zona"
        ? base.eq("zona_id", zonaId ?? "")
        : base.is("cobrador_id", null);
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

// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — AJUSTES del gaming (control del admin). Lee/escribe la fila
//  única de `ajustes_juego` (0009). Degrada a los valores por defecto si la
//  tabla aún no existe (42P01), para no romper la vista del cliente.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { AJUSTES_JUEGO_DEFAULT, type AjustesJuego } from "@/lib/juegoAjustes";
import { tablaFaltante, columnaFaltante } from "./errores";

export async function getAjustesJuego(db: SupabaseClient): Promise<AjustesJuego> {
  try {
    const { data, error } = await db.from("ajustes_juego").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) return AJUSTES_JUEGO_DEFAULT;
    return {
      activo: Boolean(data.activo),
      juegoActivo: (data.juego_activo as string) ?? AJUSTES_JUEGO_DEFAULT.juegoActivo,
      metaRacha: Number(data.meta_racha),
      premioMeta: (data.premio_meta as string) ?? AJUSTES_JUEGO_DEFAULT.premioMeta,
      mensajeBienvenida:
        (data.mensaje_bienvenida as string) ?? AJUSTES_JUEGO_DEFAULT.mensajeBienvenida,
      mostrarMisiones: Boolean(data.mostrar_misiones),
      // Temporada (columnas de 0018; si aún no existen, caen al default).
      temporadaActiva: Boolean(data.temporada_activa),
      temporadaNombre: (data.temporada_nombre as string) ?? AJUSTES_JUEGO_DEFAULT.temporadaNombre,
      temporadaEmoji: (data.temporada_emoji as string) ?? AJUSTES_JUEGO_DEFAULT.temporadaEmoji,
      temporadaMeta: Number(data.temporada_meta ?? AJUSTES_JUEGO_DEFAULT.temporadaMeta),
      temporadaPremio: (data.temporada_premio as string) ?? AJUSTES_JUEGO_DEFAULT.temporadaPremio,
      // Config del cliente (columnas de 0022; si aún no existen, caen al default).
      estrellasCiclo:
        (data.estrellas_ciclo as AjustesJuego["estrellasCiclo"]) ?? AJUSTES_JUEGO_DEFAULT.estrellasCiclo,
      umbralCaritas: Number(data.umbral_caritas ?? AJUSTES_JUEGO_DEFAULT.umbralCaritas),
    };
  } catch (e) {
    if (tablaFaltante(e)) return AJUSTES_JUEGO_DEFAULT;
    throw e;
  }
}

export async function actualizarAjustesJuego(
  db: SupabaseClient,
  a: AjustesJuego,
): Promise<void> {
  const base = {
    id: 1,
    activo: a.activo,
    juego_activo: a.juegoActivo,
    meta_racha: a.metaRacha,
    premio_meta: a.premioMeta,
    mensaje_bienvenida: a.mensajeBienvenida,
    mostrar_misiones: a.mostrarMisiones,
  };
  const conTemporada = {
    ...base,
    temporada_activa: a.temporadaActiva,
    temporada_nombre: a.temporadaNombre,
    temporada_emoji: a.temporadaEmoji,
    temporada_meta: a.temporadaMeta,
    temporada_premio: a.temporadaPremio,
  };
  const conConfig = {
    ...conTemporada,
    estrellas_ciclo: a.estrellasCiclo,
    umbral_caritas: a.umbralCaritas,
  };
  // Escalera de compatibilidad: intentá guardar TODO; si faltan columnas de una
  // migración, reintentá con menos (sin perder lo que sí existe).
  let { error } = await db.from("ajustes_juego").upsert(conConfig);
  if (!error) return;
  if (columnaFaltante(error)) {
    ({ error } = await db.from("ajustes_juego").upsert(conTemporada)); // sin 0022
    if (!error) return;
  }
  if (columnaFaltante(error)) {
    ({ error } = await db.from("ajustes_juego").upsert(base)); // sin 0018 ni 0022
    if (!error) return;
  }
  throw error;
}

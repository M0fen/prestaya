// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — ESTADO de "Para tus clientes" (hub del admin).
//  Junta, de un vistazo, en qué anda cada cosa que ve el cliente en su cartón:
//  anuncios, tienda, rifa, juegos (quiniela/raspadita) y estrellas. Sirve para
//  que el admin ENTIENDA qué está prendido sin entrar a cada pantalla.
//
//  Todo resiliente: si una feature falla o su tabla no existe, esa parte queda
//  en su valor seguro y el resto igual se muestra (el hub nunca se cae).
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAnunciosAdmin } from "./anuncios";
import { hayProductosActivos, contarSolicitudesNuevas } from "./tienda";
import { getRifa } from "./rifas";
import { getAjustesJuego } from "./juegoConfig";
import { getQuinielaAbierta } from "./promos";
import { getRedencionesPendientes } from "./estrellas";

export interface EstadoParaClientes {
  anuncios: { total: number; enPantalla: number };
  tienda: { hayProductos: boolean; leadsNuevos: number };
  rifa: { activa: boolean };
  juegos: { activo: boolean; quinielaAbierta: boolean };
  estrellas: { canjesPendientes: number };
}

/** ¿El anuncio está EN PANTALLA ahora? (activo + dentro de su ventana de fechas). */
function enPantallaAhora(a: { activo: boolean; fecha_inicio: string | null; fecha_fin: string | null }, ahoraIso: string): boolean {
  if (!a.activo) return false;
  if (a.fecha_inicio && a.fecha_inicio > ahoraIso) return false; // programado a futuro
  if (a.fecha_fin && a.fecha_fin < ahoraIso) return false; // vencido
  return true;
}

/** Lee el estado de todas las features del cartón del cliente, en paralelo. */
export async function getEstadoParaClientes(db: SupabaseClient): Promise<EstadoParaClientes> {
  const ahoraIso = new Date().toISOString();

  const [anuncios, tiendaProd, leads, rifa, ajustes, quiniela, canjes] = await Promise.all([
    getAnunciosAdmin(db).catch(() => []),
    hayProductosActivos(db).catch(() => false),
    contarSolicitudesNuevas(db).catch(() => 0),
    getRifa(db).catch(() => null),
    getAjustesJuego(db).catch(() => null),
    getQuinielaAbierta(db).catch(() => null),
    getRedencionesPendientes(db).catch(() => []),
  ]);

  return {
    anuncios: {
      total: anuncios.length,
      enPantalla: anuncios.filter((a) =>
        enPantallaAhora(
          { activo: a.activo, fecha_inicio: a.fecha_inicio ?? null, fecha_fin: a.fecha_fin ?? null },
          ahoraIso,
        ),
      ).length,
    },
    tienda: { hayProductos: tiendaProd, leadsNuevos: leads },
    rifa: { activa: Boolean(rifa?.activo) },
    juegos: { activo: Boolean(ajustes?.activo), quinielaAbierta: quiniela != null },
    estrellas: { canjesPendientes: canjes.length },
  };
}

"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Pedidos de la calle EN VIVO — lectura liviana para la franja del panel.
//
//  La llama el navegador del gestor cada tanto (y al instante cuando Realtime
//  avisa que `solicitudes_renovacion` cambió). Corre bajo SU sesión: la RLS
//  0140 recorta por zona igual que en /admin/renovaciones, así la franja nunca
//  muestra un pedido que la pantalla de Pedidos no mostraría.
//
//  Si falla ADENTRO (sesión vencida, RLS) devuelve null: el navegador se queda
//  con el último resumen bueno. El fallo de TRANSPORTE (offline, action ID
//  viejo tras un deploy) no pasa por acá: lo atrapa el catch del componente.
//  No es una consulta de dinero: acá no se tira.
// ─────────────────────────────────────────────────────────────────────────
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSolicitudesPendientes } from "@/lib/data/solicitudesRenovacion";
import { aResumen, type ResumenPedidosVivos } from "@/lib/avisosPedidos";

export async function getResumenPedidosVivos(): Promise<ResumenPedidosVivos | null> {
  try {
    const u = await getUsuarioActual();
    if (!u || !u.activo || !esGestor(u.rol)) return null;
    const db = await createSupabaseServer();
    const pendientes = await getSolicitudesPendientes(db);
    return aResumen(pendientes);
  } catch {
    return null;
  }
}

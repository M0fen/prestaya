"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — CERRAR JORNADA (rendición del cobrador).
//  El cobrador declara gastos + efectivo entregado. El RECAUDADO lo pone el
//  servidor (suma de sus pagos de hoy): no se confía en el cliente para el
//  dinero. Calcula la diferencia con el núcleo puro y guarda (RLS: solo puede
//  crear la suya). Idempotente ante doble cierre (unique cobrador+fecha).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { getEstadoJornada, crearRendicionDb } from "@/lib/data/rendicion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { registrarBitacora } from "@/lib/data/bitacora";
import { calcularRendicion, type EstadoRendicion } from "@/lib/rendicion";
import { UYU } from "@/lib/format";

type Resultado =
  | { ok: true; estado: EstadoRendicion; diferencia: number; esperado: number }
  | { ok: false; error: string };

/** Un unique violation (ya rindió hoy) se trata como "ya cerrada". */
function esDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function cerrarJornada(input: {
  gastos: number;
  entregado: number;
  notas?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };

  const db = await createSupabaseServer();
  const estado = await getEstadoJornada(db, usuario.id);
  if (!estado.disponible) {
    return { ok: false, error: "El cierre de jornada todavía no está habilitado (falta la migración 0013)." };
  }
  if (estado.yaRendida) return { ok: false, error: "Ya cerraste tu jornada de hoy." };

  const gastos = Math.max(0, Math.round(Number(input.gastos) || 0));
  const entregado = Math.max(0, Math.round(Number(input.entregado) || 0));
  const notas = (input.notas ?? "").toString().trim().slice(0, 300) || null;

  const { esperado, diferencia, estado: est } = calcularRendicion(estado.recaudado, gastos, entregado);

  try {
    await crearRendicionDb(db, {
      cobradorId: usuario.id,
      recaudado: estado.recaudado,
      cobrosCantidad: estado.cobrosCantidad,
      gastos,
      entregado,
      diferencia,
      notas,
      registradoPor: usuario.id,
    });
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Cerró jornada",
      entidad: "rendicion",
      detalle: `Entregó ${UYU(entregado)} · ${est}${diferencia !== 0 ? ` ${UYU(Math.abs(diferencia))}` : ""}`,
    });
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "cierre_jornada",
      monto: entregado,
      detalle: `${est} · entregó ${UYU(entregado)}`,
    });
    return { ok: true, estado: est, diferencia, esperado };
  } catch (e) {
    if (esDuplicado(e)) return { ok: false, error: "Ya cerraste tu jornada de hoy." };
    return { ok: false, error: "No se pudo cerrar la jornada. Probá de nuevo." };
  }
}

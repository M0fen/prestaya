"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — registrar un movimiento de CAJA (solo gestores).
//  Gastos, desembolsos, aportes de capital, retiros. Los cobros NO van por acá
//  (viven en `pagos`). RLS de 0010 exige gestor + autor = uno mismo.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { reportarError } from "@/lib/observabilidad";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { alcanceDelActor } from "@/lib/data/alcance";
import { registrarMovimientoCaja, type TipoMovimiento, type CuentaCaja } from "@/lib/data/caja";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { opIdDeterminista, esUuid } from "@/lib/idempotencia";
import { UYU } from "@/lib/format";

const TIPOS: TipoMovimiento[] = ["ingreso", "egreso", "desembolso", "retiro"];
type Resultado = { ok: true } | { ok: false; error: string };

const nonceValido = esUuid;

export async function agregarMovimientoCaja(input: {
  tipo: string;
  monto: number;
  categoria?: string | null;
  descripcion?: string | null;
  cobradorId?: string | null;
  /** operativa (default) | capital. La vista de Capital fuerza 'capital'. */
  cuenta?: string;
  visible?: boolean;
  /** Nonce de idempotencia (uuid, estable por-envío): deduplica reintentos del MISMO
   *  movimiento sin bloquear uno legítimo idéntico. Sin él, fallback determinista. */
  idempotencyKey?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return { ok: false, error: "No tenés permisos." };
  }
  if (!TIPOS.includes(input.tipo as TipoMovimiento)) {
    return { ok: false, error: "Tipo de movimiento inválido." };
  }
  const cuenta: CuentaCaja = input.cuenta === "capital" ? "capital" : "operativa";
  // Los movimientos de CAPITAL (aportes/retiros del dueño) son sensibles → solo admin.
  if (cuenta === "capital" && usuario.rol !== "admin") {
    return { ok: false, error: "Solo el administrador registra capital." };
  }
  const monto = Math.round(Number(input.monto));
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };

  // Kill switch (modo solo-lectura): un movimiento de caja MUEVE plata (egresos,
  // desembolsos, retiros, aportes de capital) → se congela durante un freeze de
  // emergencia, igual que cobros/comisiones/gastos.
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;

  // Separación por zona: un supervisor solo puede atribuir un movimiento a un
  // cobrador de SU zona (no puede "framear" a otra zona ni inflarle gastos).
  // Defensa en la acción, reforzada por RLS (0066).
  const cobradorId = input.cobradorId || null;
  if (cobradorId && usuario.rol === "supervisor") {
    const alcance = await alcanceDelActor();
    if (!alcance.global && !alcance.cobradorIds.includes(cobradorId)) {
      return { ok: false, error: "Ese cobrador no es de tu zona." };
    }
  }

  const categoria = (input.categoria ?? "").trim().slice(0, 60) || null;
  const descripcion = (input.descripcion ?? "").trim().slice(0, 200) || null;
  // Idempotencia (0074): nonce del cliente si es un uuid válido; si no, fallback
  // determinista por minuto. Deduplica el reintento del MISMO movimiento sin bloquear
  // uno legítimo idéntico (nonce nuevo por envío exitoso).
  const opId = nonceValido(input.idempotencyKey)
    ? input.idempotencyKey
    : opIdDeterminista(input.tipo, monto, categoria ?? "", descripcion ?? "", cobradorId ?? "", cuenta, Math.floor(Date.now() / 60000));

  try {
    const db = await createSupabaseServer();
    try {
      await registrarMovimientoCaja(db, {
        tipo: input.tipo as TipoMovimiento,
        monto,
        categoria,
        descripcion,
        cobradorId,
        registradoPor: usuario.id,
        cuenta,
        visible: input.visible ?? true,
        opId,
      });
    } catch (e) {
      // El índice único op_id frenó un duplicado (doble-submit / retry / dos gestores):
      // el movimiento YA quedó registrado → éxito idempotente, SIN re-auditar ni re-egresar.
      if ((e as { code?: string } | null)?.code === "23505") {
        revalidatePath("/admin/caja");
        revalidatePath("/admin/capital");
        return { ok: true };
      }
      throw e;
    }
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: cuenta === "capital" ? "Registró movimiento de capital" : "Registró movimiento de caja",
      entidad: "caja",
      detalle: `${input.tipo} ${UYU(monto)}${input.categoria ? ` · ${input.categoria}` : ""}`,
    });
    revalidatePath("/admin/caja");
    revalidatePath("/admin/capital");
    return { ok: true };
  } catch (e) {
    reportarError("registrarMovimientoCaja", e, { tipo: input.tipo });
    return { ok: false, error: "No se pudo registrar. Probá de nuevo." };
  }
}

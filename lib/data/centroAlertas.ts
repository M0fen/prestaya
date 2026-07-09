// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CENTRO DE ALERTAS del día (admin). Junta en UNA bandeja
//  priorizada las señales anti-fuga que hoy están dispersas: faltantes de
//  rendición, cobradores que recaudaron y no rindieron, cobros fuera de zona,
//  float alto, "no pago" sospechoso y desembolsos grandes. Corre como gestor;
//  el supervisor ve solo su zona (alcance).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { inicioDiaUYIso } from "@/lib/fecha";
import { tablaFaltante } from "./errores";
import { alcanceDelActor, type Alcance } from "./alcance";
import { getRendicionesDia } from "./rendicion";
import { getControlCobranza } from "./control";
import { getNoPagosSospechososHoy } from "./noPagoSospechoso";

/** Desembolso (salida de caja) que dispara alerta por su monto. Configurable a futuro. */
export const UMBRAL_DESEMBOLSO_ALERTA = 50000;

export type SeveridadAlerta = "alta" | "media" | "baja";

export interface Alerta {
  id: string;
  severidad: SeveridadAlerta;
  categoria: string;
  titulo: string;
  detalle: string;
}

export interface CentroAlertas {
  alertas: Alerta[];
  conteo: { alta: number; media: number; baja: number; total: number };
}

const UYU = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

export async function getCentroAlertas(
  db: SupabaseClient,
  hoy: Date = new Date(),
  alcancePre?: Alcance,
): Promise<CentroAlertas> {
  const alcance = alcancePre ?? (await alcanceDelActor());
  const desde = inicioDiaUYIso(hoy);

  const [rend, control, noPagos] = await Promise.all([
    getRendicionesDia(db, hoy),
    getControlCobranza(db, hoy, undefined, alcance),
    getNoPagosSospechososHoy(db, hoy, alcance),
  ]);

  const alertas: Alerta[] = [];

  // 1) Faltantes de rendición (entregó de menos) → alta.
  for (const r of rend.rendidas) {
    if (r.diferencia < 0)
      alertas.push({
        id: `faltante-${r.cobradorId}`,
        severidad: "alta",
        categoria: "Faltante de caja",
        titulo: `${r.cobradorNombre ?? "Cobrador"} entregó ${UYU(-r.diferencia)} de menos`,
        detalle: `Recaudó ${UYU(r.recaudado)} y entregó ${UYU(r.entregado)}.`,
      });
  }

  // 2) Recaudó y NO rindió (float sin declarar) → media.
  for (const p of rend.pendientes) {
    if (p.recaudado <= 0) continue;
    alertas.push({
      id: `sinrendir-${p.cobradorId}`,
      severidad: "media",
      categoria: "Sin rendir",
      titulo: `${p.nombre} recaudó ${UYU(p.recaudado)} y aún no rindió`,
      detalle: `${p.cobros} cobro(s) hoy sin cierre de jornada.`,
    });
  }

  // 3) "No pago" sospechoso (cliente cumplidor marcado no-pago) → alta/media.
  for (const n of noPagos) {
    alertas.push({
      id: `nopago-${n.clienteId}`,
      severidad: n.nivel === "sospechoso" ? "alta" : "media",
      categoria: "No pago sospechoso",
      titulo: `${n.clienteNombre}: ${n.motivo}`,
      detalle: `${n.cuotasPagadas}/${n.cuotasVencidas} cuotas al día · cobrador ${n.cobradorNombre ?? "—"}.`,
    });
  }

  // 4) Cobros fuera de zona / float alto (del control de cobranza).
  for (const a of control.alertas) {
    alertas.push({
      id: a.id,
      severidad: a.severidad === "alta" ? "alta" : "media",
      categoria: a.titulo.includes("zona") ? "Fuera de zona" : "Float alto",
      titulo: a.titulo,
      detalle: a.detalle,
    });
  }

  // 5) Desembolsos grandes de hoy (salida de capital) → media.
  try {
    let q = db
      .from("movimientos_caja")
      .select("monto, categoria, descripcion, cobrador_id, registrado_en")
      .eq("tipo", "desembolso")
      .gte("registrado_en", desde)
      .gte("monto", UMBRAL_DESEMBOLSO_ALERTA);
    if (!alcance.global) q = q.in("cobrador_id", alcance.cobradorIds);
    const { data, error } = await q;
    if (error) throw error;
    for (const m of data ?? []) {
      alertas.push({
        id: `desembolso-${(m.registrado_en as string)}-${Math.round(Number(m.monto))}`,
        severidad: "media",
        categoria: "Desembolso grande",
        titulo: `Desembolso de ${UYU(Number(m.monto))}`,
        detalle: `${(m.categoria as string | null) || (m.descripcion as string | null) || "Salida de capital"}.`,
      });
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  const orden: Record<SeveridadAlerta, number> = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad]);

  const conteo = {
    alta: alertas.filter((a) => a.severidad === "alta").length,
    media: alertas.filter((a) => a.severidad === "media").length,
    baja: alertas.filter((a) => a.severidad === "baja").length,
    total: alertas.length,
  };
  return { alertas, conteo };
}

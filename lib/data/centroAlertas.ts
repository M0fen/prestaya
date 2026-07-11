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
import { getRendicionesDia, type ResumenRendiciones } from "./rendicion";
import { getControlCobranza, type ControlCobranza } from "./control";
import { getNoPagosSospechososHoy } from "./noPagoSospechoso";
import { getResumenCompromisos, type ResumenCompromisos } from "./gestionesCobranza";

/** Desembolso (salida de caja) que dispara alerta por su monto. Configurable a futuro. */
export const UMBRAL_DESEMBOLSO_ALERTA = 50000;

export type SeveridadAlerta = "alta" | "media" | "baja";

export interface Alerta {
  id: string;
  severidad: SeveridadAlerta;
  categoria: string;
  titulo: string;
  detalle: string;
  /** A dónde ir para actuar sobre esta señal ("Ver y actuar →"). */
  href?: string;
  /** Si la señal es atribuible a un cobrador: para avisarle sin salir. */
  cobradorId?: string | null;
  cobradorNombre?: string | null;
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
  // Inyección de dependencias (perf): "Mi jornada" ya computa control+rendiciones
  // para el cierre → los pasa acá para no recomputarlos (control es caro: RPC de
  // cartera + paginación de pagos). Sin deps, se comportan como siempre.
  deps?: { control?: ControlCobranza; rend?: ResumenRendiciones; compromisos?: ResumenCompromisos },
): Promise<CentroAlertas> {
  const alcance = alcancePre ?? (await alcanceDelActor());
  const desde = inicioDiaUYIso(hoy);

  const [rend, control, noPagos, compromisos] = await Promise.all([
    // Ya acotado por zona (pasamos alcance): antes iba sin alcance y se filtraba
    // después; ahora la consulta ya viene chica.
    deps?.rend ?? getRendicionesDia(db, hoy, alcance),
    deps?.control ?? getControlCobranza(db, hoy, undefined, alcance),
    getNoPagosSospechososHoy(db, hoy, alcance),
    deps?.compromisos ?? getResumenCompromisos(db, alcance, hoy),
  ]);

  // Recorte por zona a SUS cobradores (defensa; si el rend ya vino acotado es un
  // no-op). Usamos variables LOCALES: no mutamos `rend`, que puede venir
  // compartido con getCierrePorZona (mutarlo corrompería su consolidado).
  let rendidas = rend.rendidas;
  let pendientes = rend.pendientes;
  if (!alcance.global) {
    const cobs = new Set(alcance.cobradorIds);
    rendidas = rendidas.filter((r) => cobs.has(r.cobradorId));
    pendientes = pendientes.filter((p) => cobs.has(p.cobradorId));
  }

  const alertas: Alerta[] = [];

  // 1) Faltantes de rendición (entregó de menos) → alta.
  for (const r of rendidas) {
    if (r.diferencia < 0)
      alertas.push({
        id: `faltante-${r.cobradorId}`,
        severidad: "alta",
        categoria: "Faltante de caja",
        titulo: `${r.cobradorNombre ?? "Cobrador"} entregó ${UYU(-r.diferencia)} de menos`,
        detalle: `Recaudó ${UYU(r.recaudado)} y entregó ${UYU(r.entregado)}.`,
        href: "/admin/caja",
        cobradorId: r.cobradorId,
        cobradorNombre: r.cobradorNombre ?? null,
      });
  }

  // 2) Recaudó y NO rindió (float sin declarar) → media.
  for (const p of pendientes) {
    if (p.recaudado <= 0) continue;
    alertas.push({
      id: `sinrendir-${p.cobradorId}`,
      severidad: "media",
      categoria: "Sin rendir",
      titulo: `${p.nombre} recaudó ${UYU(p.recaudado)} y aún no rindió`,
      detalle: `${p.cobros} cobro(s) hoy sin cierre de jornada.`,
      href: "/admin/caja",
      cobradorId: p.cobradorId,
      cobradorNombre: p.nombre ?? null,
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
      href: `/admin/clientes/${n.clienteId}`,
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
      href: "/admin/cobranza",
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
        href: "/admin/caja",
      });
    }
  } catch (e) {
    if (!tablaFaltante(e)) throw e;
  }

  // 6) Compromisos de pago INCUMPLIDOS (prometió pagar y no pagó) → alta. El
  //    nombre del cliente se trae en lote (lista chica) para que la alerta sea útil.
  if (compromisos.incumplidos.length > 0) {
    const ids = compromisos.incumplidos.map((c) => c.clienteId);
    const nombre = new Map<string, string>();
    try {
      const { data } = await db.from("clientes").select("id, nombre").in("id", ids);
      for (const c of data ?? []) nombre.set(c.id as string, c.nombre as string);
    } catch {
      /* sin nombres: se usa "Cliente" */
    }
    for (const c of compromisos.incumplidos) {
      const pendiente = Math.max(0, c.monto - c.pagadoDesde);
      alertas.push({
        id: `compromiso-${c.clienteId}-${c.fecha}`,
        severidad: "alta",
        categoria: "Compromiso incumplido",
        titulo: `${nombre.get(c.clienteId) ?? "Cliente"}: prometió ${UYU(c.monto)} y no pagó`,
        detalle: `Se comprometió para el ${c.fecha}${c.gestorNombre ? ` · gestión de ${c.gestorNombre}` : ""}. Pendiente ${UYU(pendiente)}.`,
        href: `/admin/clientes/${c.clienteId}`,
      });
    }
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

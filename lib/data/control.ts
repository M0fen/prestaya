// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CONTROL anti-fuga del dueño (admin/supervisor).
//  Proyecciones sobre los datos reales: ranking de cobradores, mapa de calor
//  de cobros (GPS) y alertas de anomalía (pago fuera de zona, float alto).
//  Corre como gestor (RLS permite ver todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluarZona } from "@/lib/geo";
import { inicioDiaUYIso, hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { traerTodo } from "./paginado";
import { getActivosConPagos } from "./activos";
import { alcanceDelActor, type Alcance } from "./alcance";

/** Efectivo por cobrador que dispara alerta de rendición (hasta tener módulo de caja). */
const LIMITE_FLOAT = 15000;

export interface RankingCobrador {
  cobradorId: string;
  nombre: string;
  recaudado: number;
  esperado: number;
  cobrados: number;
  pendientes: number;
  anomalias: number;
  progreso: number; // 0..1
}

export type Severidad = "alta" | "media" | "baja";
export interface AlertaControl {
  id: string;
  severidad: Severidad;
  titulo: string;
  detalle: string;
}

export interface PuntoCobro {
  /** Dónde se registró el cobro (GPS del teléfono). */
  lat: number;
  lng: number;
  /** Domicilio del cliente (para dibujar la geo-cerca / la "fuga"). */
  casaLat: number | null;
  casaLng: number | null;
  enZona: boolean | null;
  clienteNombre: string;
  cobradorNombre: string | null;
}

export interface ControlCobranza {
  resumen: {
    recaudadoHoy: number;
    cobrosHoy: number;
    fueraZona: number;
    cobradores: number;
  };
  ranking: RankingCobrador[];
  alertas: AlertaControl[];
  mapaCobros: PuntoCobro[];
}

interface Coord {
  lat: number | null;
  lng: number | null;
}
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function getControlCobranza(
  db: SupabaseClient,
  hoy: Date = new Date(),
  activosPre?: import("./activos").ActivoConPagos[],
  alcancePre?: Alcance,
): Promise<ControlCobranza> {
  const desde = inicioDiaUYIso(hoy);

  // A ESCALA: los créditos activos (con cliente/gps/cobrador embebidos) vienen de
  // la RPC `app_cartera_activa` (una fila por crédito). El cobrador de cada
  // cliente sale del propio crédito (cobrador_id), sin traer asignaciones.
  // Alcance del gestor: el supervisor ve SOLO los cobradores de su zona.
  const alcance = alcancePre ?? (await alcanceDelActor());
  let cobQuery = db
    .from("usuarios")
    .select("id, nombre")
    .eq("rol", "cobrador")
    .eq("activo", true);
  if (!alcance.global) cobQuery = cobQuery.in("id", alcance.cobradorIds);
  const cobRes = await cobQuery;
  if (cobRes.error) throw cobRes.error;
  const activos = activosPre ?? (await getActivosConPagos(db, alcance));

  const cobradores = (cobRes.data ?? []).map((c) => ({
    id: c.id as string,
    nombre: c.nombre as string,
  }));
  const cobradorDeCliente = new Map<string, string>();
  const prestamoPorCliente = new Map<string, { id: string; cuota: number }>();
  const prestamoPorId = new Map<string, { clienteId: string; cuota: number }>();
  const cliente = new Map<string, { nombre: string; gps: Coord }>();
  for (const p of activos) {
    if (p.cobrador_id) cobradorDeCliente.set(p.cliente_id, p.cobrador_id);
    prestamoPorCliente.set(p.cliente_id, { id: p.id, cuota: Number(p.cuota_diaria) });
    prestamoPorId.set(p.id, { clienteId: p.cliente_id, cuota: Number(p.cuota_diaria) });
    cliente.set(p.cliente_id, {
      nombre: p.cliente_nombre ?? "",
      gps: { lat: num(p.cliente_gps_lat), lng: num(p.cliente_gps_lng) },
    });
  }

  // Eventos de HOY (pagos + visitas de créditos activos), paginados y sin .in().
  const [pagosRaw, visRaw] = await Promise.all([
    traerTodo<{ prestamo_id: string; monto: number; registrado_por: string | null; gps_lat: number | null; gps_lng: number | null }>(
      (d, h) =>
        db
          .from("pagos")
          .select("prestamo_id, monto, registrado_por, gps_lat, gps_lng, prestamos!inner(estado)")
          .eq("prestamos.estado", "activo")
          .eq("anulado", false)
          .gte("registrado_en", desde)
          // Orden estable por PK: sin él la paginación puede duplicar/saltear.
          .order("id", { ascending: true })
          .range(d, h),
    ),
    traerTodo<{ prestamo_id: string; cobrador_id: string; resultado: string }>((d, h) =>
      db
        .from("visitas")
        .select("prestamo_id, cobrador_id, resultado, prestamos!inner(estado)")
        .eq("prestamos.estado", "activo")
        .gte("registrado_en", desde)
        .order("id", { ascending: true })
        .range(d, h),
    ),
  ]);

  // Acumuladores por cobrador.
  const acc = new Map<string, { recaudado: number; esperado: number; cobrados: Set<string>; noPagos: number; anomalias: number; asignados: number }>();
  const init = (id: string) => {
    if (!acc.has(id)) acc.set(id, { recaudado: 0, esperado: 0, cobrados: new Set(), noPagos: 0, anomalias: 0, asignados: 0 });
    return acc.get(id)!;
  };
  for (const c of cobradores) init(c.id);

  // Esperado = suma de cuotas de clientes asignados con préstamo activo.
  for (const [clienteId, cobradorId] of cobradorDeCliente) {
    const pr = prestamoPorCliente.get(clienteId);
    if (!pr) continue;
    const a = init(cobradorId);
    a.esperado += pr.cuota;
    a.asignados += 1;
  }

  const alertas: AlertaControl[] = [];
  const puntos: PuntoCobro[] = [];
  let recaudadoHoy = 0;
  let fueraZona = 0;

  // Acota a los pagos de créditos DENTRO del alcance (activos ya scopeado). Para
  // el admin no cambia (tiene todos los activos); para el supervisor descarta
  // pagos de otras zonas que el RLS pudiera dejar pasar.
  const pagosScoped = alcance.global
    ? pagosRaw
    : pagosRaw.filter((p) => prestamoPorId.has(p.prestamo_id as string));

  for (const p of pagosScoped) {
    const monto = Number(p.monto);
    recaudadoHoy += monto;
    const loan = prestamoPorId.get(p.prestamo_id as string);
    const clienteId = loan?.clienteId;
    const cli = clienteId ? cliente.get(clienteId) : undefined;
    const cobradorId = (p.registrado_por as string | null) ?? (clienteId ? cobradorDeCliente.get(clienteId) : undefined);

    const a = cobradorId ? init(cobradorId) : null;
    if (a && loan) {
      a.recaudado += monto;
      a.cobrados.add(loan.clienteId);
    }

    const zona = evaluarZona({ lat: num(p.gps_lat), lng: num(p.gps_lng) }, cli?.gps ?? null);
    const enZona = zona ? zona.enZona : null;
    if (zona && !zona.enZona) {
      fueraZona++;
      if (a) a.anomalias += 1;
      const cob = cobradores.find((c) => c.id === cobradorId);
      alertas.push({
        id: `zona-${p.prestamo_id}-${recaudadoHoy}`,
        severidad: "alta",
        titulo: "Pago fuera de zona",
        detalle: `${cob?.nombre ?? "Cobrador"} cobró a ${cli?.nombre ?? "cliente"} lejos de su domicilio (GPS ⚠).`,
      });
    }
    if (num(p.gps_lat) != null && num(p.gps_lng) != null)
      puntos.push({
        lat: Number(p.gps_lat),
        lng: Number(p.gps_lng),
        casaLat: cli?.gps.lat ?? null,
        casaLng: cli?.gps.lng ?? null,
        enZona,
        clienteNombre: cli?.nombre ?? "",
        cobradorNombre: cobradores.find((c) => c.id === cobradorId)?.nombre ?? null,
      });
  }

  for (const v of visRaw) {
    const res = v.resultado as string;
    const cobradorId = v.cobrador_id as string | null;
    // Solo visitas de cobradores dentro del alcance (evita contar otras zonas).
    if (!cobradorId || (!alcance.global && !acc.has(cobradorId))) continue;
    if (res !== "pago" && res !== "abono") init(cobradorId).noPagos += 1;
  }

  // ¿Quién ya rindió hoy? Para NO acusar de "sin rendir" a quien ya cerró su
  // caja (coherencia: el float alto solo importa mientras el efectivo sigue en
  // la calle). Degrada al comportamiento previo si falta la tabla (0013).
  const rendidos = new Set<string>();
  try {
    let q = db.from("rendiciones").select("cobrador_id").eq("fecha", toIso(hoyUY(hoy)));
    if (!alcance.global) q = q.in("cobrador_id", alcance.cobradorIds);
    const { data } = await q;
    for (const r of data ?? []) rendidos.add(r.cobrador_id as string);
  } catch {
    /* 0013 ausente → nadie figura como rendido; se mantiene la alerta de siempre. */
  }

  // Alertas de float alto — solo para quien AÚN no rindió (efectivo en la calle).
  for (const c of cobradores) {
    const a = acc.get(c.id)!;
    if (a.recaudado > LIMITE_FLOAT && !rendidos.has(c.id))
      alertas.push({
        id: `float-${c.id}`,
        severidad: "media",
        titulo: "Float alto sin rendir",
        detalle: `${c.nombre} lleva $${a.recaudado.toLocaleString("es-UY")} cobrados hoy y aún no rinde (sugerido rendir sobre $${LIMITE_FLOAT.toLocaleString("es-UY")}).`,
      });
  }

  const ranking: RankingCobrador[] = cobradores
    .map((c) => {
      const a = acc.get(c.id)!;
      const cobrados = a.cobrados.size;
      return {
        cobradorId: c.id,
        nombre: c.nombre,
        recaudado: a.recaudado,
        esperado: a.esperado,
        cobrados,
        pendientes: Math.max(0, a.asignados - cobrados - a.noPagos),
        anomalias: a.anomalias,
        progreso: a.esperado > 0 ? a.recaudado / a.esperado : 0,
      };
    })
    .sort((x, y) => y.recaudado - x.recaudado);

  const orden: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad]);

  return {
    resumen: {
      recaudadoHoy,
      cobrosHoy: (pagosRaw).length,
      fueraZona,
      cobradores: cobradores.length,
    },
    ranking,
    alertas,
    mapaCobros: puntos,
  };
}

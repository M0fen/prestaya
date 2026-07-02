// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — CONTROL anti-fuga del dueño (admin/supervisor).
//  Proyecciones sobre los datos reales: ranking de cobradores, mapa de calor
//  de cobros (GPS) y alertas de anomalía (pago fuera de zona, float alto).
//  Corre como gestor (RLS permite ver todo).
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluarZona } from "@/lib/geo";
import { inicioDiaUYIso } from "@/lib/fecha";

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
): Promise<ControlCobranza> {
  const desde = inicioDiaUYIso(hoy);

  // Datos base.
  const [cobRes, asigRes, presRes, cliRes] = await Promise.all([
    db.from("usuarios").select("id, nombre").eq("rol", "cobrador").eq("activo", true),
    db.from("asignaciones").select("cobrador_id, cliente_id").eq("activo", true),
    db.from("prestamos").select("id, cliente_id, cuota_diaria").eq("estado", "activo"),
    db.from("clientes").select("*"),
  ]);
  for (const r of [cobRes, asigRes, presRes, cliRes]) if (r.error) throw r.error;

  const cobradores = (cobRes.data ?? []).map((c) => ({
    id: c.id as string,
    nombre: c.nombre as string,
  }));
  const cobradorDeCliente = new Map<string, string>();
  for (const a of asigRes.data ?? [])
    cobradorDeCliente.set(a.cliente_id as string, a.cobrador_id as string);

  const prestamoPorCliente = new Map<string, { id: string; cuota: number }>();
  const prestamoPorId = new Map<string, { clienteId: string; cuota: number }>();
  for (const p of presRes.data ?? []) {
    prestamoPorCliente.set(p.cliente_id as string, { id: p.id as string, cuota: Number(p.cuota_diaria) });
    prestamoPorId.set(p.id as string, { clienteId: p.cliente_id as string, cuota: Number(p.cuota_diaria) });
  }
  const cliente = new Map<string, { nombre: string; gps: Coord }>();
  for (const c of cliRes.data ?? [])
    cliente.set(c.id as string, {
      nombre: c.nombre as string,
      gps: { lat: num(c.gps_lat), lng: num(c.gps_lng) },
    });

  // Eventos de HOY.
  const ids = [...prestamoPorId.keys()];
  const [pagosRes, visRes] = await Promise.all([
    ids.length
      ? db.from("pagos").select("prestamo_id, monto, registrado_por, gps_lat, gps_lng").eq("anulado", false).gte("registrado_en", desde).in("prestamo_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? db.from("visitas").select("prestamo_id, cobrador_id, resultado").gte("registrado_en", desde).in("prestamo_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (pagosRes.error) throw pagosRes.error;
  if (visRes.error) throw visRes.error;

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

  for (const p of pagosRes.data ?? []) {
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

  for (const v of visRes.data ?? []) {
    const res = v.resultado as string;
    const cobradorId = v.cobrador_id as string | null;
    if (cobradorId && res !== "pago" && res !== "abono") init(cobradorId).noPagos += 1;
  }

  // Alertas de float alto.
  for (const c of cobradores) {
    const a = acc.get(c.id)!;
    if (a.recaudado > LIMITE_FLOAT)
      alertas.push({
        id: `float-${c.id}`,
        severidad: "media",
        titulo: "Float alto sin rendir",
        detalle: `${c.nombre} lleva $${a.recaudado.toLocaleString("es-UY")} cobrados hoy (sugerido rendir sobre $${LIMITE_FLOAT.toLocaleString("es-UY")}).`,
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
      cobrosHoy: (pagosRes.data ?? []).length,
      fueraZona,
      cobradores: cobradores.length,
    },
    ranking,
    alertas,
    mapaCobros: puntos,
  };
}

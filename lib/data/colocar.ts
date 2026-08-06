// ─────────────────────────────────────────────────────────────────────────
//  Candidatos para colocar capital DESDE LA CALLE (08-05).
//
//  Dos listas, cada una con su regla:
//   · RENOVAR — clientes de la ruta cuyo crédito activo ya está SALDADO. La
//     verdad la da el cartón (mismo cálculo que ve el cliente), no un campo
//     guardado: `falta < 1` es el mismo umbral que usa el gate del servidor,
//     porque las cuotas fraccionarias heredadas de Disapp (351,04 × 24) dejan
//     residuos de centavos que son incobrables.
//   · NUEVA VENTA — clientes de la ruta SIN crédito activo pero CON historial
//     (el primer crédito de alguien lo da la oficina).
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstadosCarton } from "@/lib/cartones";
import {
  calcularCuotaRenovacion,
  montoRenovacionAutoAprobable,
  montoRenovacionPedido,
  requiereAprobacionAdmin,
  topeAumentoPct,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { getPagosDePrestamo } from "./pagos";
import { traerTodo } from "./paginado";
import type { Cliente, Prestamo } from "@/types/db";

export interface CandidatoColocar {
  clienteId: string;
  nombre: string;
  documento: string | null;
  /** Solo en "renovar": el crédito saldado que se va a repetir. */
  prestamoId?: string;
  /** Términos del crédito que TERMINÓ (renovar) o del último crédito (venta). */
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: string;
  /** Solo en "renovar": capital del crédito NUEVO = anterior +20% (regla del
   *  negocio), ya recortado al tope del tramo y al CAP. Lo calcula el servidor
   *  con la misma función que después da el alta, así la tarjeta nunca promete
   *  un número distinto del que se va a colocar. */
  montoNuevo?: number;
  /** Solo en "renovar": cuota del crédito NUEVO, arrastrando la tasa del anterior. */
  cuotaNueva?: number;
  /** El cobrador NO puede darlo de alta solo (se pasa del tope del sistema): el
   *  toque manda una solicitud al admin en vez de fallar. */
  requiereAprobacion?: boolean;
  /** Cuánto le falta pagar (renovar: < 1 por definición). */
  falta?: number;
  /** Deuda VIVA del cliente en sus OTROS créditos activos (0 si no tiene). Se
   *  avisa en pantalla al renovar: el cliente terminó este crédito pero sigue
   *  debiendo en otro, y el que presta tiene que saberlo antes de decidir. */
  deudaHermano?: number;
  /** Hasta cuánto puede colocar el cobrador SIN pedir permiso. Se calcula con
   *  `topeAumentoPct` — la MISMA función que después valida el alta — así la
   *  pantalla nunca ofrece un monto que el servidor va a rechazar. */
  techo: number;
}

/** Techo auto-aprobable para un monto anterior dado (nunca por encima del CAP). */
function techoDe(montoAnterior: number): number {
  const pct = topeAumentoPct(montoAnterior);
  return Math.min(RENOVACION_CAP_TOTAL, Math.round(montoAnterior * (1 + pct / 100)));
}

/** Clientes de MI ruta que ya terminaron de pagar: listos para renovar.
 *
 *  `cobradorId`: dueño de los créditos que se pueden renovar. Hace falta porque la
 *  RLS de `prestamos` filtra por CLIENTE, no por crédito: en un cliente compartido
 *  entre dos rutas (53 reales) esta lista le ofrecía al cobrador el crédito
 *  SALDADO del compañero, y el servidor se lo rechazaba recién al confirmar —
 *  letra roja delante del cliente, el mismo mal trago del día 1. */
export async function getCandidatosRenovar(
  db: SupabaseClient,
  cobradorId?: string | null,
): Promise<CandidatoColocar[]> {
  const { data: asig } = await db.from("asignaciones").select("cliente_id").eq("activo", true);
  const ids = [...new Set((asig ?? []).map((a) => a.cliente_id as string))];
  if (ids.length === 0) return [];

  const activos = await traerTodo<Prestamo>((d, h) =>
    db
      .from("prestamos")
      .select("*")
      .eq("estado", "activo")
      .in("cliente_id", ids)
      .order("id", { ascending: true })
      .range(d, h),
  );
  if (activos.length === 0) return [];

  const { data: cls } = await db
    .from("clientes")
    .select("id, nombre, documento, activo")
    .in("id", [...new Set(activos.map((p) => p.cliente_id))]);
  const cliDe = new Map((cls ?? []).map((c) => [c.id as string, c as unknown as Cliente]));

  const hoy = hoyUY();
  // Saldo POR CRÉDITO: entra a "Renovar" cada crédito que quedó en cero. El
  // multi-crédito es legítimo (regla del negocio), así que un cliente que terminó
  // uno y sigue pagando otro SÍ puede renovar el terminado — el gate del 08-04
  // que exigía TODOS los créditos en cero lo hacía desaparecer de esta lista sin
  // ningún mensaje (reporte de campo 08-05, caso 8). La deuda del crédito hermano
  // viaja en `deudaHermano` para que la pantalla la AVISE en vez de esconder al
  // cliente: la decisión de prestarle igual es del negocio, no del filtro.
  const faltaDe = new Map<string, number>();
  const deudaPorCliente = new Map<string, number>();
  for (const p of activos) {
    const pagos = await getPagosDePrestamo(db, p.id);
    const carton = calcularEstadosCarton(p, pagos, hoy);
    faltaDe.set(p.id, carton.falta);
    if (carton.falta >= 1)
      deudaPorCliente.set(p.cliente_id, (deudaPorCliente.get(p.cliente_id) ?? 0) + carton.falta);
  }
  const out: CandidatoColocar[] = [];
  for (const p of activos) {
    const cli = cliDe.get(p.cliente_id);
    if (!cli || !cli.activo) continue;
    // El crédito del compañero NO se ofrece: renovarlo lo rechaza el servidor
    // (la comisión sería suya). La deuda de ese crédito igual viaja en
    // `deudaHermano`, así que el cobrador se entera de que existe.
    if (cobradorId && p.cobrador_id && p.cobrador_id !== cobradorId) continue;
    const carton = { falta: faltaDe.get(p.id) ?? 0 };
    // Mismo umbral que el gate del servidor: un residuo de centavos no traba.
    if (carton.falta >= 1) continue;
    // Y el mismo CAP que el servidor: un crédito heredado por encima del tope
    // (GERARDO VARELA, $120.000) el servidor lo rechaza igual — ofrecerlo en la
    // lista rompe la promesa de que acá nunca aparece algo que va a rebotar.
    const montoAnterior = Math.round(Number(p.monto_prestado) || 0);
    const cuotaAnterior = Number(p.cuota_diaria) || 0;
    const totalDias = Number(p.total_dias) || 0;
    // ¿El cobrador puede darlo de alta solo, o hay que pedirle a la oficina?
    // Antes los créditos por encima del tope se SALTEABAN mudos de la lista: el
    // cliente terminaba de pagar y desaparecía, sin explicación ni forma de
    // pedirlo. Ahora aparecen marcados y el toque manda la solicitud al admin
    // (decisión de Carlos, 06-08).
    const requiereAprobacion = requiereAprobacionAdmin(montoAnterior);
    // Los números del crédito NUEVO, con las MISMAS funciones que usa el alta: la
    // tarjeta de la calle muestra lo que se va a colocar, no lo que ya se pagó.
    const montoNuevo = requiereAprobacion
      ? montoRenovacionPedido(montoAnterior)
      : montoRenovacionAutoAprobable(montoAnterior);
    const cuotaNueva = calcularCuotaRenovacion(
      { monto: montoAnterior, cuota: cuotaAnterior, totalDias },
      montoNuevo,
      totalDias,
    );
    out.push({
      clienteId: p.cliente_id,
      nombre: cli.nombre,
      documento: cli.documento ?? null,
      prestamoId: p.id,
      monto: montoAnterior,
      cuota: Math.round(cuotaAnterior),
      totalDias,
      frecuencia: (p.frecuencia as string) ?? "diario",
      falta: Math.max(0, Math.round(carton.falta)),
      techo: techoDe(montoAnterior),
      montoNuevo,
      cuotaNueva,
      requiereAprobacion,
      deudaHermano: Math.round(deudaPorCliente.get(p.cliente_id) ?? 0),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Clientes de MI ruta SIN crédito activo y CON historial: listos para vender. */
export async function getCandidatosVenta(db: SupabaseClient): Promise<CandidatoColocar[]> {
  const { data: asig } = await db.from("asignaciones").select("cliente_id").eq("activo", true);
  const ids = [...new Set((asig ?? []).map((a) => a.cliente_id as string))];
  if (ids.length === 0) return [];

  const todos = await traerTodo<Prestamo>((d, h) =>
    db
      .from("prestamos")
      .select("*")
      .in("cliente_id", ids)
      .order("id", { ascending: true })
      .range(d, h),
  );
  const conActivo = new Set(todos.filter((p) => p.estado === "activo").map((p) => p.cliente_id));

  // Último crédito por cliente (de ahí salen los términos sugeridos y la tasa).
  const ultimo = new Map<string, Prestamo>();
  for (const p of todos) {
    const prev = ultimo.get(p.cliente_id);
    if (!prev || String(p.fecha_inicio) > String(prev.fecha_inicio)) ultimo.set(p.cliente_id, p);
  }

  const elegibles = [...ultimo.entries()].filter(([cid]) => !conActivo.has(cid));
  if (elegibles.length === 0) return [];

  const { data: cls } = await db
    .from("clientes")
    .select("id, nombre, documento, activo")
    .in("id", elegibles.map(([cid]) => cid));
  const cliDe = new Map((cls ?? []).map((c) => [c.id as string, c as unknown as Cliente]));

  return elegibles
    .flatMap(([cid, p]) => {
      const cli = cliDe.get(cid);
      if (!cli || !cli.activo) return [];
      const monto = Math.round(Number(p.monto_prestado) || 0);
      const cuota = Math.round(Number(p.cuota_diaria) || 0);
      const totalDias = Number(p.total_dias) || 0;
      // Sin historial usable, el alta la hace la oficina: no se ofrece acá.
      if (!(monto > 0 && cuota > 0 && totalDias > 0)) return [];
      return [
        {
          clienteId: cid,
          nombre: cli.nombre,
          documento: cli.documento ?? null,
          monto,
          cuota,
          totalDias,
          frecuencia: (p.frecuencia as string) ?? "diario",
          techo: techoDe(monto),
        },
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

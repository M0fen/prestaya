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
  montoRenovacionSugerido,
  topeAumentoPct,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { UYU } from "@/lib/format";
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
  /** Solo en "renovar": capital que se PROPONE = el MISMO del crédito anterior
   *  (el crédito se repite tal cual). Es editable en la calle hasta `techo`. */
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
    // Los números del crédito NUEVO, con las MISMAS funciones que usa el alta: la
    // tarjeta de la calle muestra lo que se va a colocar, no lo que ya se pagó.
    // Lo que se PROPONE es repetir el crédito igual. `montoRenovacionAutoAprobable`
    // es el TECHO hasta donde puede subirlo solo, y viaja aparte (`techo`).
    const montoNuevo = montoRenovacionSugerido(montoAnterior);
    // ⚠️ ¿El monto PROPUESTO necesita permiso? Ya nunca: repetir el crédito va solo
    // (regla de Carlos, 07-08). Se calcula igual —contra el TECHO, no contra el
    // CAP— para que la pantalla no vuelva a prometer algo distinto de lo que hace
    // el servidor: antes un heredado de $120.000 se marcaba "requiere aprobación"
    // y el botón decía "Pedir a la oficina" mientras el servidor lo aprobaba solo.
    const requiereAprobacion = montoNuevo > montoRenovacionAutoAprobable(montoAnterior);
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
      techo: montoRenovacionAutoAprobable(montoAnterior),
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
  // ⚠️ REGLA DEL NEGOCIO (Carlos, 07-08): un cliente PUEDE tener VARIOS créditos a
  // la vez, sin estar al día con los anteriores (hasta 10 en la cartera viva). Acá se los EXCLUÍA (`!conActivo`) y por
  // eso el operador no encontraba a nadie para la venta nueva: el que ya estaba
  // pagando —o sea, casi toda la ruta— no aparecía en ninguna de las dos listas.
  // La deuda viva del otro crédito NO se esconde: viaja en `deudaHermano` y la
  // tarjeta la muestra antes de que el cobrador decida.

  // Último crédito por cliente (de ahí salen los términos sugeridos y la tasa).
  const ultimo = new Map<string, Prestamo>();
  for (const p of todos) {
    const prev = ultimo.get(p.cliente_id);
    if (!prev || String(p.fecha_inicio) > String(prev.fecha_inicio)) ultimo.set(p.cliente_id, p);
  }
  const elegibles = [...ultimo.entries()];
  if (elegibles.length === 0) return [];

  // Deuda VIVA de los créditos que siguen abiertos, por cliente: es lo que el
  // cobrador tiene que ver antes de darle un segundo crédito a alguien.
  const hoyCal = hoyUY();
  const deudaViva = new Map<string, number>();
  for (const p of todos) {
    if (p.estado !== "activo") continue;
    const pagos = await getPagosDePrestamo(db, p.id);
    const { falta } = calcularEstadosCarton(p, pagos, hoyCal);
    if (falta >= 1) deudaViva.set(p.cliente_id, (deudaViva.get(p.cliente_id) ?? 0) + falta);
  }

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
          deudaHermano: Math.round(deudaViva.get(cid) ?? 0),
        },
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Un cliente de la ruta que HOY no se puede colocar, y el motivo en criollo. */
export interface NoElegible {
  clienteId: string;
  nombre: string;
  documento: string | null;
  /** Qué le pasa, dicho como se lo diría un compañero. */
  motivo: string;
  /** Qué puede hacer el cobrador al respecto (null = nada, solo esperar). */
  queHacer: string | null;
}

/**
 * Los clientes de MI ruta que NO están en ninguna de las dos listas, con el
 * MOTIVO.
 *
 * ⚠️ Reporte de campo (07-08): "el operador no encuentra por dónde hacer la nueva
 * venta; si entra a renovar no le aparece, y en nueva venta aparece un listado
 * pero ella no". Las dos listas están FILTRADAS por reglas correctas, pero un
 * cliente que no cumple ninguna simplemente DESAPARECE — sin decir por qué ni qué
 * hacer. Es el mismo callejón sin salida que ya nos costó el censo el día 1: el
 * cobrador se queda parado frente al cliente creyendo que la app está rota.
 *
 * Los dos casos reales:
 *   · Todavía está pagando  → se renueva cuando termine (le falta $X).
 *   · Ya tiene otro crédito → un segundo crédito en paralelo lo da la oficina.
 * Nunca se esconde a nadie: si no se puede, se dice por qué.
 */
export async function getNoElegibles(
  db: SupabaseClient,
  cobradorId: string | null,
  modo: "renovar" | "venta" = "renovar",
): Promise<NoElegible[]> {
  // En NUEVA VENTA ya casi no hay bloqueados: desde el 07-08 un cliente puede
  // tener VARIOS créditos a la vez sin estar al día (hasta 10 en la cartera viva). El único que no aparece es el
  // que nunca tuvo crédito (su primero lo da la oficina), y ese caso lo resuelve
  // la ficha del cliente con `PedirAyuda`, no esta lista.
  if (modo === "venta") return [];
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
  if (activos.length === 0) return []; // sin créditos activos → todos elegibles

  const hoy = hoyUY();
  const porCliente = new Map<string, { falta: number; ajenos: number; propios: number }>();
  for (const p of activos) {
    const pagos = await getPagosDePrestamo(db, p.id);
    const { falta } = calcularEstadosCarton(p, pagos, hoy);
    const acc = porCliente.get(p.cliente_id) ?? { falta: 0, ajenos: 0, propios: 0 };
    const esAjeno = !!cobradorId && !!p.cobrador_id && p.cobrador_id !== cobradorId;
    if (esAjeno) acc.ajenos += 1;
    else {
      acc.propios += 1;
      acc.falta += Math.max(0, falta);
    }
    porCliente.set(p.cliente_id, acc);
  }

  const conDeuda = [...porCliente.entries()].filter(([, v]) => v.falta >= 1 || v.ajenos > 0);
  if (conDeuda.length === 0) return [];

  const { data: cls } = await db
    .from("clientes")
    .select("id, nombre, documento, activo")
    .in("id", conDeuda.map(([cid]) => cid));
  const cliDe = new Map((cls ?? []).map((c) => [c.id as string, c as unknown as Cliente]));

  return conDeuda
    .flatMap(([cid, v]) => {
      const cli = cliDe.get(cid);
      if (!cli || !cli.activo) return [];
      // Créditos SOLO del compañero: no es su parada ni su decisión.
      if (v.propios === 0)
        return [
          {
            clienteId: cid,
            nombre: cli.nombre,
            documento: cli.documento ?? null,
            motivo: "Su crédito es de otro cobrador.",
            queHacer: "Que lo renueve él, o pedile a tu supervisor que te lo pase.",
          },
        ];
      return [
        {
          clienteId: cid,
          nombre: cli.nombre,
          documento: cli.documento ?? null,
          motivo: `Todavía está pagando: le falta ${UYU(Math.round(v.falta))}.`,
          queHacer:
            "Se RENUEVA cuando termine. Si necesita plata ahora, dale una NUEVA VENTA: puede tener varios créditos a la vez.",
        },
      ];
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

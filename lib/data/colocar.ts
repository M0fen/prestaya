// ─────────────────────────────────────────────────────────────────────────
//  Candidatos para colocar capital DESDE LA CALLE (08-05).
//
//  Dos listas, cada una con su regla:
//   · RENOVAR — clientes de la ruta cuyo crédito activo ya está SALDADO. La
//     verdad la da el cartón (mismo cálculo que ve el cliente), no un campo
//     guardado: `falta < 1` es el mismo umbral que usa el gate del servidor,
//     porque las cuotas fraccionarias heredadas de Disapp (351,04 × 24) dejan
//     residuos de centavos que son incobrables.
//   · NUEVA VENTA — todos los clientes de la ruta: con historial se arrastra su
//     tasa y su techo; el que NUNCA tuvo crédito sale como PRIMER crédito al 20%
//     del negocio (regla de Carlos, 08-13 — antes "lo daba la oficina" y todo
//     censo terminaba en un pedido esperando días).
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularEstadosCarton } from "@/lib/cartones";
import {
  calcularCuotaRenovacion,
  montoRenovacionAutoAprobable,
  montoRenovacionSugerido,
  techoRenovacion,
  techoVentaNueva,
  techoVentaGestor,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { UYU } from "@/lib/format";
import { getPagosDeVariosPrestamos } from "./pagos";
import { traerTodo } from "./paginado";
import type { Cliente, Pago, Prestamo } from "@/types/db";

export interface CandidatoColocar {
  clienteId: string;
  nombre: string;
  documento: string | null;
  /** Solo en "renovar": el crédito saldado que se va a repetir. */
  prestamoId?: string;
  /** Solo en "renovar": desde cuándo corría ese crédito ("YYYY-MM-DD"). Es lo único
   *  que distingue DOS créditos saldados del mismo monto — y hay clientes con dos
   *  (SONIA TELIS llegó a tener 4 de $15.000×30). Sin la fecha, las dos tarjetas
   *  son idénticas y el cobrador no sabe cuál está renovando. Mismo criterio que el
   *  selector de crédito de la ficha. */
  desde?: string;
  /** Términos del crédito que TERMINÓ (renovar) o del último crédito (venta). */
  monto: number;
  cuota: number;
  /** La cuota SIN redondear, solo para que el navegador calcule la cuota estimada
   *  con la misma tasa exacta que usa el servidor. 53 créditos vivos vienen de
   *  Disapp con cuota fraccionaria (8.425/24 = 351,04): redondeando la base, la
   *  cuota que la pantalla le dice al cliente salía hasta $1 distinta de la que
   *  quedaba guardada. Se muestra `cuota`; esto es solo para la cuenta. */
  cuotaExacta?: number;
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
  /** Hasta cuánto puede colocar el cobrador SIN pedir permiso. Se calcula con la
   *  MISMA función que después valida el alta, así la pantalla nunca ofrece un
   *  monto que el servidor va a rechazar. */
  techo: number;
  /** Tope DURO: por encima de esto no lo puede ni la oficina, así que el botón no
   *  puede prometer "se manda el pedido". Solo viaja en "renovar" (el camino que
   *  tiene puerta a la oficina); en la venta nueva el techo YA es el máximo. */
  maximo?: number;
  /** Es su PRIMER crédito (nunca tuvo, o su historial vino roto del import): sale
   *  al 20% del negocio y lo coloca el cobrador directo, con el CAP como único
   *  tope (regla de Carlos, 08-13). `monto`/`cuota`/`totalDias` vienen en 0. */
  primerCredito?: boolean;
  /** El "primer crédito" viene de un historial con términos ROTOS del import (no
   *  de alguien que nunca tuvo): la tarjeta no puede decir "Nunca tuvo crédito"
   *  al lado del aviso de deuda viva — dos frases que se niegan (auditoría 08-14). */
  historialRoto?: boolean;
}

/**
 * Ids de cliente de la ruta (asignaciones activas bajo la RLS del que consulta),
 * PAGINADO: el corte mudo de PostgREST a 1000 dejaba fuera justo a la asignación
 * más nueva — el recién censado, que desde el 08-13 es candidato a su primer
 * crédito. Con ~120 clientes por ruta hoy no muerde, pero el censo directo
 * acelera el crecimiento y este es el camino nuevo (auditoría 08-14).
 */
async function clientesDeLaRuta(db: SupabaseClient): Promise<string[]> {
  const filas = await traerTodo<{ cliente_id: string }>((d, h) =>
    db
      .from("asignaciones")
      .select("cliente_id")
      .eq("activo", true)
      .order("id", { ascending: true })
      .range(d, h),
  );
  return [...new Set(filas.map((a) => a.cliente_id))];
}

/**
 * `falta` de cada crédito, en UNA sola consulta de pagos (paginada).
 *
 * ⚠️ Esto era un N+1 en SERIE: `getPagosDePrestamo` por cada crédito activo de la
 * ruta. Para Luz Ángela (124 créditos activos) eran 124 round-trips por pasada, y
 * "Nueva venta" hace dos pasadas → ~250 viajes encadenados antes de pintar la
 * primera tarjeta. En la calle, con señal pobre, eso se acerca al tope de 22 s de
 * la página: el operador ve una pantalla en blanco y concluye que la app está rota
 * — que es literalmente lo que reportó el 07-08.
 */
async function faltaDeCreditos(
  db: SupabaseClient,
  creditos: Prestamo[],
  hoy: Date,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (creditos.length === 0) return out;
  const pagosDe = await getPagosDeVariosPrestamos(db, creditos.map((p) => p.id));
  const vacio: Pago[] = [];
  for (const p of creditos)
    out.set(p.id, calcularEstadosCarton(p, pagosDe[p.id] ?? vacio, hoy).falta);
  return out;
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
  const ids = await clientesDeLaRuta(db);
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
  const faltaDe = await faltaDeCreditos(db, activos, hoy);
  const deudaPorCliente = new Map<string, number>();
  for (const p of activos) {
    const falta = faltaDe.get(p.id) ?? 0;
    if (falta >= 1) deudaPorCliente.set(p.cliente_id, (deudaPorCliente.get(p.cliente_id) ?? 0) + falta);
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
      desde: p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : undefined,
      monto: montoAnterior,
      cuota: Math.round(cuotaAnterior),
      cuotaExacta: cuotaAnterior,
      totalDias,
      frecuencia: (p.frecuencia as string) ?? "diario",
      falta: Math.max(0, Math.round(carton.falta)),
      techo: montoRenovacionAutoAprobable(montoAnterior),
      // El tope duro del servidor (`renovarDesdeCalle` rechaza por encima). La
      // tarjeta lo necesita para no ofrecer "se manda el pedido a la oficina" por
      // un monto que la oficina TAMPOCO puede aprobar: ese botón mentía y el
      // cobrador se comía el rojo delante del cliente.
      maximo: techoRenovacion(montoAnterior),
      montoNuevo,
      cuotaNueva,
      requiereAprobacion,
      deudaHermano: Math.round(deudaPorCliente.get(p.cliente_id) ?? 0),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Clientes de MI ruta listos para vender: los que tienen historial (la tasa se
 *  arrastra de su último crédito) y también los que NUNCA tuvIERON uno — el
 *  recién censado sale como PRIMER crédito al 20% (regla de Carlos, 08-13). */
export async function getCandidatosVenta(db: SupabaseClient): Promise<CandidatoColocar[]> {
  const ids = await clientesDeLaRuta(db);
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
  // ⚠️ El desempate por `creado_en` NO es cosmético: tiene que dar el MISMO crédito
  // que `getUltimoCreditoDe`, que es contra el que el servidor mide el techo. El
  // empalme cargó lotes enteros con la misma `fecha_inicio`, así que los empates
  // son comunes; sin el desempate la pantalla dibujaba "podés darle hasta $X"
  // calculado sobre un crédito y el servidor validaba contra otro.
  const ultimo = new Map<string, Prestamo>();
  const masNuevo = (a: Prestamo, b: Prestamo) => {
    const fa = String(a.fecha_inicio ?? "");
    const fb = String(b.fecha_inicio ?? "");
    if (fa !== fb) return fa > fb;
    return String(a.creado_en ?? "") > String(b.creado_en ?? "");
  };
  // ⚠️ El techo +20% se mide sobre ESTE último crédito registrado (regla de
  // Carlos, 19-08 segunda vuelta) — no sobre el más grande de su historia.
  for (const p of todos) {
    // La venta DESHECHA (cancelado) no es historial: misma regla que
    // getUltimoCreditoDe — pantalla y servidor eligen el MISMO "último".
    if (p.estado === "cancelado") continue;
    const prev = ultimo.get(p.cliente_id);
    if (!prev || masNuevo(p, prev)) ultimo.set(p.cliente_id, p);
  }
  // Deuda VIVA de los créditos que siguen abiertos, por cliente: es lo que el
  // cobrador tiene que ver antes de darle un segundo crédito a alguien.
  const hoyCal = hoyUY();
  const abiertos = todos.filter((p) => p.estado === "activo");
  const faltaDe = await faltaDeCreditos(db, abiertos, hoyCal);
  const deudaViva = new Map<string, number>();
  for (const p of abiertos) {
    const falta = faltaDe.get(p.id) ?? 0;
    if (falta >= 1) deudaViva.set(p.cliente_id, (deudaViva.get(p.cliente_id) ?? 0) + falta);
  }

  // Los clientes se buscan por TODA la ruta (no solo los que ya tuvieron crédito):
  // el recién censado no tiene ni una fila en `prestamos` y aun así es candidato —
  // su PRIMER crédito lo coloca el cobrador directo (Carlos, 08-13). Antes ese
  // cliente no aparecía en NINGUNA lista y el único camino era pedirlo por aviso.
  // Paginado por lo mismo que arriba: la respuesta de `.in(ids)` también corta a 1000.
  const cls = await traerTodo<Cliente>((d, h) =>
    db.from("clientes").select("id, nombre, documento, activo").in("id", ids).order("id", { ascending: true }).range(d, h),
  );
  const cliDe = new Map(cls.map((c) => [c.id, c]));

  /** Tarjeta de PRIMER crédito: sin términos que arrastrar, tope = CAP. */
  const primero = (cid: string, cli: Cliente, historialRoto: boolean): CandidatoColocar => ({
    clienteId: cid,
    nombre: cli.nombre,
    documento: cli.documento ?? null,
    monto: 0,
    cuota: 0,
    totalDias: 0,
    frecuencia: "diario",
    techo: RENOVACION_CAP_TOTAL,
    maximo: RENOVACION_CAP_TOTAL,
    primerCredito: true,
    historialRoto,
    deudaHermano: Math.round(deudaViva.get(cid) ?? 0),
  });

  const conUltimo = new Set(ultimo.keys());
  const out: CandidatoColocar[] = [];
  for (const cid of ids) {
    const cli = cliDe.get(cid);
    if (!cli || !cli.activo) continue;
    if (!conUltimo.has(cid)) {
      // Nunca tuvo un crédito: primer crédito, directo.
      out.push(primero(cid, cli, false));
      continue;
    }
    const p = ultimo.get(cid)!;
    const monto = Math.round(Number(p.monto_prestado) || 0);
    const cuota = Math.round(Number(p.cuota_diaria) || 0);
    const totalDias = Number(p.total_dias) || 0;
    if (!(monto > 0 && cuota > 0 && totalDias > 0)) {
      // Tiene filas pero con términos rotos del import: no hay tasa que arrastrar
      // ni techo que medir → mismas reglas que un primer crédito (20%, tope CAP).
      // Es EXACTAMENTE lo que hace el servidor (`conHistorial` da false).
      out.push(primero(cid, cli, true));
      continue;
    }
    out.push({
      clienteId: cid,
      nombre: cli.nombre,
      documento: cli.documento ?? null,
      monto,
      cuota,
      totalDias,
      frecuencia: (p.frecuencia as string) ?? "diario",
      // Techo y máximo contra el ÚLTIMO crédito registrado (`monto`), la misma
      // referencia que usa nuevaVentaDesdeCalle (refTecho = baseTasa.monto).
      techo: techoVentaNueva(monto),
      // ⚠️ El tope DURO de una venta nueva es lo que el GESTOR puede autorizar
      // (techoVentaGestor: +20% del anterior con piso en el CAP — regla de Carlos
      // 16-08), LA MISMA función que valida nuevaVentaDesdeCalle y aprobarSolicitud.
      // Sin este dato la pantalla no distinguía "no lo podés dar VOS" de "no lo
      // puede NADIE" y siempre elegía el mensaje más duro; y con el CAP a secas
      // acá, ofrecía "pedir hasta $100.000" cuando el server ya acepta $108.000
      // para un anterior de $90.000 — la queja del admin otra vez desde la calle.
      maximo: techoVentaGestor(monto),
      deudaHermano: Math.round(deudaViva.get(cid) ?? 0),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
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
 *   · Su crédito es de OTRO cobrador → que lo renueve él o lo pase el supervisor.
 * (El "segundo crédito lo da la oficina" murió el 07-08, y el "primer crédito lo
 * da la oficina" el 08-13: hoy los dos salen por Nueva venta, directo.)
 * Nunca se esconde a nadie: si no se puede, se dice por qué.
 */
export async function getNoElegibles(
  db: SupabaseClient,
  cobradorId: string | null,
  modo: "renovar" | "venta" = "renovar",
): Promise<NoElegible[]> {
  // En NUEVA VENTA ya no hay bloqueados: desde el 07-08 un cliente puede tener
  // VARIOS créditos a la vez sin estar al día (hasta 10 en la cartera viva), y
  // desde el 08-13 hasta el que NUNCA tuvo crédito aparece como candidato (su
  // primer crédito lo coloca el cobrador directo, regla de Carlos).
  if (modo === "venta") return [];
  const ids = await clientesDeLaRuta(db);
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
  const faltaDe = await faltaDeCreditos(db, activos, hoy);
  const porCliente = new Map<string, { falta: number; ajenos: number; propios: number }>();
  for (const p of activos) {
    const falta = faltaDe.get(p.id) ?? 0;
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
      // ⚠️ Y también cuando lo PROPIO ya está saldado: la deuda que lo trajo a esta
      // lista es del compañero, así que el cartel de abajo saldría con el número
      // vacío — "Todavía está pagando: le falta $0", que no significa nada.
      if (v.propios === 0 || v.falta < 1)
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

import "server-only";
// ─────────────────────────────────────────────────────────────────────────
//  ESTADO DE LA OPERACIÓN — lo que hoy es invisible para el supervisor.
//
//  Todas las alertas del sistema se gatillan por ACTIVIDAD: cobró y no rindió,
//  faltante en la caja, GPS fuera de zona, float alto. El que no hace nada no
//  dispara ninguna — es invisible. Y hay tres cosas más que directamente no se
//  ven desde ninguna pantalla:
//
//   · la CARGA de cada cobrador (hoy: mediana 59 clientes, máximo 125);
//   · los clientes SIN RUTA, que además son invisibles por construcción: la RLS
//     deriva la zona de un cliente de su cobrador, así que un cliente sin
//     cobrador no tiene zona y ningún supervisor lo ve;
//   · los clientes de un cobrador dado de baja, que encima desaparecen del
//     tablero de cobranza porque `control.ts` filtra `.eq("activo", true)`.
//
//  ⚠️ SOLO LECTURA. Acá no se mueve un cliente ni se toca plata: esto es hacer
//  visible lo invisible. Reasignar es otra cosa y vive en otro lado.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { esGlobal, enLotes, type Alcance } from "./alcance";
import { traerTodo } from "./paginado";

/** id de zona → nombre. Aparte del join porque `usuarios` tiene más de una
 *  relación con `zonas` y PostgREST no puede resolver cuál embeber. */
async function mapaDeZonas(
  db: SupabaseClient,
  zonaIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(zonaIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  const { data } = await db.from("zonas").select("id, nombre").in("id", ids);
  return new Map((data ?? []).map((z) => [z.id as string, z.nombre as string]));
}

/** Una fila del panel "quién no está cobrando". */
export interface CobradorEnSilencio {
  cobradorId: string;
  nombre: string;
  zonaNombre: string | null;
  /** Clientes en su ruta. */
  clientes: number;
  /** Créditos activos a su nombre. */
  creditosActivos: number;
  /** Plata que le falta cobrar de esos créditos (UYU entero). */
  capitalVivo: number;
  /** Días desde su último cobro registrado. `null` = NUNCA usó la app. */
  diasSinCobrar: number | null;
  /** "YYYY-MM-DD" del último cobro, o null. */
  ultimoCobro: string | null;
}

/**
 * Cobradores activos ORDENADOS POR PLATA EN RIESGO: los que tienen cartera viva
 * y hace más tiempo que no registran un cobro.
 *
 * ⚠️ POR QUÉ ESTO NO ES UNA ALARMA CON UMBRAL. Se midió la distribución real
 * (04-09) antes de elegir un número, y ningún umbral sirve: a 7 días dispara
 * sobre 46 de 47 cobradores (98%), a 14 sobre 41 (87%), a 30 sobre 30 (64%). La
 * causa es que 27 de los 47 NUNCA registraron un cobro por la app — la adopción,
 * no el abandono. Una alarma que suena para el 98% enseña a ignorarla, que es
 * exactamente lo que ya pasó con los umbrales de campo (76% y 81%).
 *
 * Así que se muestra como una LISTA ORDENADA por lo que se puede perder, con los
 * que nunca usaron la app separados: son dos problemas distintos y el segundo no
 * se arregla llamando por teléfono un martes.
 */
export async function getCobradoresEnSilencio(
  db: SupabaseClient,
  alcance: Alcance,
): Promise<CobradorEnSilencio[]> {
  // Cobradores del alcance.
  // ⚠️ SIN join implícito a `zonas`: hay MÁS DE UNA relación entre `usuarios` y
  // `zonas` (la zona del cobrador y la tabla puente de supervisores), así que
  // PostgREST no sabe cuál embeber y falla con "more than one relationship".
  // Se traen los nombres de zona aparte, que además es una consulta trivial.
  let q = db
    .from("usuarios")
    .select("id, nombre, zona_id")
    .eq("rol", "cobrador")
    .eq("activo", true);
  if (!esGlobal(alcance)) {
    if (alcance.cobradorIds.length === 0) return [];
    q = q.in("id", alcance.cobradorIds);
  }
  const { data: cobs, error } = await q;
  if (error) throw error; // dice quién tiene plata sin mirar: no se traga
  const cobradores = (cobs ?? []) as { id: string; nombre: string; zona_id: string | null }[];
  if (cobradores.length === 0) return [];
  const ids = cobradores.map((c) => c.id);
  const nombreZona = await mapaDeZonas(db, cobradores.map((c) => c.zona_id));

  // Cartera viva por cobrador (créditos ACTIVOS a su nombre).
  const creditos = await traerTodo<{ cobrador_id: string; cuota_diaria: number; total_dias: number; pagado_acum: number }>(
    (desde, hasta) =>
      db
        .from("prestamos")
        .select("cobrador_id, cuota_diaria, total_dias, pagado_acum")
        .eq("estado", "activo")
        .in("cobrador_id", ids)
        .range(desde, hasta),
  );
  const cartera = new Map<string, { n: number; vivo: number }>();
  for (const p of creditos) {
    const k = p.cobrador_id;
    if (!k) continue;
    const falta = Math.max(
      0,
      Math.round(Number(p.cuota_diaria) * Number(p.total_dias) - Number(p.pagado_acum)),
    );
    const acc = cartera.get(k) ?? { n: 0, vivo: 0 };
    acc.n += 1;
    acc.vivo += falta;
    cartera.set(k, acc);
  }

  // Clientes en ruta por cobrador.
  const asigs = await traerTodo<{ cobrador_id: string; cliente_id: string }>((desde, hasta) =>
    db.from("asignaciones").select("cobrador_id, cliente_id").eq("activo", true).in("cobrador_id", ids).range(desde, hasta),
  );
  const clientesPor = new Map<string, Set<string>>();
  for (const a of asigs) {
    if (!clientesPor.has(a.cobrador_id)) clientesPor.set(a.cobrador_id, new Set());
    clientesPor.get(a.cobrador_id)!.add(a.cliente_id);
  }

  // Último cobro NATIVO de cada uno (origen null = trabajo hecho en la app).
  //
  // ⚠️ SE PREGUNTA UNO POR UNO, Y NO ES UN CAPRICHO. Antes era un solo `.in(...)`
  // con `.limit(2000)` ordenado por fecha: eso trae los 2.000 pagos más recientes
  // de TODA la operación y se queda con el primero de cada cobrador — o sea, una
  // ventana GLOBAL. Medido el 08-09 esa ventana llegaba hasta el 20-08: los 14
  // cobradores cuyo último cobro era anterior quedaban SIN fecha, y `null` acá
  // significa "nunca cobró por la app". El bloque decía 4 cobradores / $5.061.405
  // cuando la verdad eran 18 / $21.530.905, y /admin/operacion —que ve el dueño—
  // imprimía CON NOMBRE Y APELLIDO como "nunca usaron la app" a gente con cientos
  // de cobros (María Curbelo, 272; Karent Londoño, 366). El sesgo estaba invertido:
  // cuanto más tiempo llevaba alguien sin cobrar, más seguro se caía de la lista.
  // Con una consulta por cobrador la ventana es la suya y el índice parcial
  // idx_pagos_registrador_fecha (registrado_por, registrado_en) la resuelve sola.
  const ultimo = new Map<string, string>();
  for (const tanda of enLotes(ids, 12)) {
    const res = await Promise.all(
      tanda.map((id) =>
        db
          .from("pagos")
          .select("registrado_en")
          .eq("anulado", false)
          .is("origen", null)
          .eq("registrado_por", id)
          .order("registrado_en", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    );
    res.forEach((r, i) => {
      // Un error acá dejaría al cobrador pintado como "nunca cobró": se lanza.
      if (r.error) throw r.error;
      const v = r.data?.registrado_en as string | undefined;
      if (v) ultimo.set(tanda[i], v);
    });
  }

  const hoy = Date.now();
  const filas = cobradores.map((c): CobradorEnSilencio => {
    const ult = ultimo.get(c.id) ?? null;
    const cart = cartera.get(c.id) ?? { n: 0, vivo: 0 };
    return {
      cobradorId: c.id,
      nombre: c.nombre,
      zonaNombre: c.zona_id ? (nombreZona.get(c.zona_id) ?? null) : null,
      clientes: clientesPor.get(c.id)?.size ?? 0,
      creditosActivos: cart.n,
      capitalVivo: cart.vivo,
      diasSinCobrar: ult ? Math.floor((hoy - new Date(ult).getTime()) / 86_400_000) : null,
      ultimoCobro: ult ? ult.slice(0, 10) : null,
    };
  });

  // Primero el que más plata tiene sin mirar. Entre iguales, el que hace más que
  // no cobra. Los que NUNCA cobraron van al final: es adopción, no abandono.
  return filas
    .filter((f) => f.capitalVivo > 0 || f.clientes > 0)
    .sort((a, b) => {
      if ((a.diasSinCobrar === null) !== (b.diasSinCobrar === null)) return a.diasSinCobrar === null ? 1 : -1;
      if (b.capitalVivo !== a.capitalVivo) return b.capitalVivo - a.capitalVivo;
      return (b.diasSinCobrar ?? 0) - (a.diasSinCobrar ?? 0);
    });
}

/** Un cliente que no está en la ruta de nadie. */
export interface ClienteSinRuta {
  clienteId: string;
  nombre: string;
  documento: string | null;
  /** Créditos ACTIVOS que tiene hoy. Si es > 0, es plata que nadie sale a cobrar. */
  creditosActivos: number;
  /** Saldo vivo de esos créditos. */
  capitalVivo: number;
  /** ¿Alguna vez tuvo un crédito? Distingue "se cayó de la ruta" de "padrón". */
  tuvoCredito: boolean;
}

export interface ClientesSinRuta {
  /** Los que tienen crédito ACTIVO: plata en la calle que ninguna ruta muestra. */
  conPlataViva: ClienteSinRuta[];
  /** Los que tuvieron crédito alguna vez y hoy no están en ninguna ruta. */
  exClientes: ClienteSinRuta[];
  /** Cuántos son en total los clientes sin asignación (incluye el padrón). */
  total: number;
  /** Cuántos de esos nunca tuvieron un crédito (padrón heredado). */
  soloPadron: number;
}

/**
 * Clientes sin asignación activa.
 *
 * ⚠️ SE LEE CON service_role, Y NO ES UN ATAJO. Estos clientes son invisibles
 * POR CONSTRUCCIÓN: la RLS deriva la zona de un cliente de su cobrador
 * (`app_zona_de_cliente`), así que un cliente sin cobrador no tiene zona y
 * `app_gestor_ve_cliente` devuelve false para TODOS los supervisores. No es que
 * no tengan permiso: es que no hay zona contra la cual dar permiso. La RLS no se
 * tocó — el acceso se controla con el gate de rol de la página, igual que en
 * `lib/data/correcciones.ts`.
 *
 * Tampoco tiene sentido acotarlo por zona: un cliente sin cobrador no pertenece
 * a ninguna. Por eso la lista se ordena por RELEVANCIA y no se vuelca entera:
 * medido el 04-09 son 10.597 clientes, de los cuales 0 tienen crédito activo y
 * 566 tuvieron alguno alguna vez. El resto es padrón heredado del import, y
 * listar 10.000 fichas que nadie va a mirar no es visibilidad, es ruido.
 */
export async function getClientesSinRuta(limite = 200): Promise<ClientesSinRuta> {
  const admin = createSupabaseAdmin();

  // Los clientes que SÍ están en alguna ruta (para excluirlos).
  // ⚠️ `.order("id")` NO es decorativo: traerTodo pagina por OFFSET, y sin un orden
  // estable Postgres puede devolver las filas en otro orden entre páginas → un
  // cliente se repite y otro se saltea. Con 10.597 clientes son 11 páginas: sin
  // orden, "sin ruta" incluía gente que sí está en una ruta (y al revés).
  const asigs = await traerTodo<{ cliente_id: string }>((desde, hasta) =>
    admin.from("asignaciones").select("cliente_id").eq("activo", true).order("id", { ascending: true }).range(desde, hasta),
  );
  const enRuta = new Set(asigs.map((a) => a.cliente_id));

  const clientes = await traerTodo<{ id: string; nombre: string; documento: string | null }>((desde, hasta) =>
    admin.from("clientes").select("id, nombre, documento").eq("activo", true).order("id", { ascending: true }).range(desde, hasta),
  );
  const sinRuta = clientes.filter((c) => !enRuta.has(c.id));
  if (sinRuta.length === 0) return { conPlataViva: [], exClientes: [], total: 0, soloPadron: 0 };

  // Créditos de esos clientes: separa "plata viva" de "ex cliente" de "padrón".
  const ids = sinRuta.map((c) => c.id);
  const creditos: { cliente_id: string; estado: string; cuota_diaria: number; total_dias: number; pagado_acum: number }[] = [];
  for (const lote of enLotes(ids)) {
    const { data, error } = await admin
      .from("prestamos")
      .select("cliente_id, estado, cuota_diaria, total_dias, pagado_acum")
      .in("cliente_id", lote);
    if (error) throw error;
    creditos.push(...((data ?? []) as typeof creditos));
  }
  const porCliente = new Map<string, { activos: number; vivo: number; alguno: boolean }>();
  for (const p of creditos) {
    const acc = porCliente.get(p.cliente_id) ?? { activos: 0, vivo: 0, alguno: false };
    acc.alguno = true;
    if (p.estado === "activo") {
      acc.activos += 1;
      acc.vivo += Math.max(
        0,
        Math.round(Number(p.cuota_diaria) * Number(p.total_dias) - Number(p.pagado_acum)),
      );
    }
    porCliente.set(p.cliente_id, acc);
  }

  const filas = sinRuta.map((c): ClienteSinRuta => {
    const x = porCliente.get(c.id) ?? { activos: 0, vivo: 0, alguno: false };
    return {
      clienteId: c.id,
      nombre: c.nombre,
      documento: c.documento,
      creditosActivos: x.activos,
      capitalVivo: x.vivo,
      tuvoCredito: x.alguno,
    };
  });

  return {
    conPlataViva: filas.filter((f) => f.creditosActivos > 0).sort((a, b) => b.capitalVivo - a.capitalVivo),
    exClientes: filas
      .filter((f) => f.creditosActivos === 0 && f.tuvoCredito)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .slice(0, limite),
    total: filas.length,
    soloPadron: filas.filter((f) => !f.tuvoCredito).length,
  };
}

/** Cartera que quedó a nombre de alguien que ya no trabaja. */
export interface CarteraDeBaja {
  cobradorId: string;
  nombre: string;
  zonaNombre: string | null;
  clientes: number;
  creditosActivos: number;
  capitalVivo: number;
}

/**
 * Clientes cuyo cobrador fue DESACTIVADO.
 *
 * El offboarding (`setUsuarioActivo`) solo pone `activo=false` y banea el login:
 * no toca ni un cliente, ni una asignación, ni un crédito. Los clientes quedan en
 * una ruta que ya nadie puede abrir y ADEMÁS desaparecen del tablero de cobranza,
 * porque `control.ts` filtra `.eq("activo", true)`. O sea: plata que se vuelve
 * invisible justo cuando más hay que mirarla.
 *
 * Se lee con service_role por el mismo motivo que arriba: la zona del cliente se
 * deriva de su cobrador, y un cobrador dado de baja sigue teniendo zona, pero el
 * supervisor no tiene por qué llegar a él desde ninguna pantalla existente.
 * Medido el 04-09: 0 casos — todavía no se dio de baja a un cobrador con cartera.
 * La vista existe para el día que pase, que es cuando nadie la va a construir.
 */
export async function getCarteraDeBaja(alcance: Alcance): Promise<CarteraDeBaja[]> {
  const admin = createSupabaseAdmin();
  let q = admin
    .from("usuarios")
    .select("id, nombre, zona_id")
    .eq("rol", "cobrador")
    .eq("activo", false);
  if (!esGlobal(alcance)) {
    if (alcance.zonas.length === 0) return [];
    q = q.in("zona_id", alcance.zonas);
  }
  const { data: bajas, error } = await q;
  if (error) throw error;
  const cobs = (bajas ?? []) as { id: string; nombre: string; zona_id: string | null }[];
  if (cobs.length === 0) return [];
  const ids = cobs.map((c) => c.id);
  const nombreZona = await mapaDeZonas(admin, cobs.map((c) => c.zona_id));

  const asigs = await traerTodo<{ cobrador_id: string; cliente_id: string }>((desde, hasta) =>
    admin.from("asignaciones").select("cobrador_id, cliente_id").eq("activo", true).in("cobrador_id", ids).range(desde, hasta),
  );
  const creditos = await traerTodo<{ cobrador_id: string; cuota_diaria: number; total_dias: number; pagado_acum: number }>(
    (desde, hasta) =>
      admin
        .from("prestamos")
        .select("cobrador_id, cuota_diaria, total_dias, pagado_acum")
        .eq("estado", "activo")
        .in("cobrador_id", ids)
        .range(desde, hasta),
  );

  return cobs
    .map((c): CarteraDeBaja => {
      const mios = creditos.filter((p) => p.cobrador_id === c.id);
      return {
        cobradorId: c.id,
        nombre: c.nombre,
        zonaNombre: c.zona_id ? (nombreZona.get(c.zona_id) ?? null) : null,
        clientes: new Set(asigs.filter((a) => a.cobrador_id === c.id).map((a) => a.cliente_id)).size,
        creditosActivos: mios.length,
        capitalVivo: mios.reduce(
          (s, p) =>
            s +
            Math.max(0, Math.round(Number(p.cuota_diaria) * Number(p.total_dias) - Number(p.pagado_acum))),
          0,
        ),
      };
    })
    .filter((c) => c.clientes > 0 || c.creditosActivos > 0)
    .sort((a, b) => b.capitalVivo - a.capitalVivo);
}

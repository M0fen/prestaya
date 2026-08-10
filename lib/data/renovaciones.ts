// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RENOVACIÓN pre-aprobada (admin/supervisor).
//  Detecta clientes con el crédito por completar/completado y les corre el
//  SCORING (ya construido) para sugerir acción y monto del próximo crédito.
//  Enchufa el momento de mayor conversión con la decisión de plata.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { Cliente, Prestamo } from "@/types/db";
import type { ResultadoScore } from "@/types/scoring";
import { getClientesAsignados } from "./clientes";
import { traerTodo } from "./paginado";
import { getPagosDePrestamo } from "./pagos";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { getPrestamoPorId } from "./prestamos";
import { getHistorialCrediticio } from "./scoring";
import { calcularEstadosCarton, proximoDiaCobro } from "@/lib/cartones";
import { calcularScore } from "@/lib/scoring";
import { calcularCuotaRenovacion, RENOVACION_CAP_TOTAL } from "@/lib/renovacion";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { reportarError } from "@/lib/observabilidad";

/** Subconjunto de Prestamo que realmente se lee al armar candidatos (evita el
 *  doble cast `as unknown as Prestamo` sobre un SELECT parcial — deuda #21). */
type PrestamoRenov = Pick<
  Prestamo,
  "id" | "cobrador_id" | "monto_prestado" | "cuota_diaria" | "total_dias" | "frecuencia" | "fecha_inicio"
>;

/** Datos del crédito actual, base para calcular los términos del próximo. */
export interface PrestamoAnterior {
  id: string;
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: import("@/types/db").FrecuenciaPrestamo;
  cobradorId: string | null;
}

export interface CandidatoRenovacion {
  cliente: Cliente;
  progresoPct: number;
  completo: boolean;
  cuotasFaltantes: number;
  score: ResultadoScore;
  prestamoAnterior: PrestamoAnterior;
  /** Marcado como moroso (aviso al renovar). false si falta la 0027. */
  moroso: boolean;
}

/** Resultado de la búsqueda de candidatos + cuántos quedaron fuera del corte. */
export interface ListaCandidatos {
  candidatos: CandidatoRenovacion[];
  /** Total que califica (antes de cortar en `limite`). */
  totalQueCalifican: number;
  /** Cuántos quedaron sin mostrar por el corte (0 = se ven todos). */
  ocultos: number;
}

/** Normaliza para comparar: sin tildes, minúsculas. Así "GARCIA" encuentra "García". */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Candidatos a renovación: clientes con préstamo activo cuyo avance supera
 * `umbral` (por completar) o que ya completaron. Ordenados por el más avanzado.
 *
 * `q` filtra por NOMBRE o DOCUMENTO **antes** del corte de `limite`. Sin eso, la
 * lista se cortaba en los 60 más avanzados y el resto quedaba INALCANZABLE: hoy
 * hay 155 créditos saldados, o sea 95 clientes que terminaron de pagar y a los
 * que la oficina no podía renovarles nada porque no había forma de buscarlos.
 */
export async function getCandidatosRenovacion(
  db: SupabaseClient,
  hoy: Date = new Date(),
  umbral = 0.75,
  limite = 60,
  q: string | null = null,
): Promise<CandidatoRenovacion[]> {
  return (await listarCandidatosRenovacion(db, hoy, umbral, limite, q)).candidatos;
}

/** Igual que `getCandidatosRenovacion` pero informa cuántos quedaron ocultos. */
export async function listarCandidatosRenovacion(
  db: SupabaseClient,
  hoy: Date = new Date(),
  umbral = 0.75,
  limite = 60,
  q: string | null = null,
): Promise<ListaCandidatos> {
  const vacio: ListaCandidatos = { candidatos: [], totalQueCalifican: 0, ocultos: 0 };
  const clientes = await getClientesAsignados(db);
  if (clientes.length === 0) return vacio;

  // PAGINADO obligatorio: PostgREST corta en 1000 filas. Con ~2.300 créditos
  // activos, sin esto la lista de candidatos a renovación perdía en SILENCIO más
  // de la mitad de la cartera → clientes que ya calificaban nunca se le ofrecían
  // al gestor (capital que no se vuelve a colocar). Orden estable por `id`.
  const presRaw = await traerTodo<Record<string, unknown>>((d, h) =>
    db
      .from("prestamos")
      .select("id, cliente_id, cobrador_id, monto_prestado, cuota_diaria, total_dias, frecuencia, fecha_inicio")
      .eq("estado", "activo")
      .order("id", { ascending: true })
      .range(d, h),
  );

  // Agrupamos TODOS los créditos activos por cliente. Indexar por cliente_id con
  // set() perdía todos menos el último → los 94 clientes multi-crédito (0037 quitó
  // la regla "un activo por cliente") quedaban con créditos avanzados sin evaluar.
  const prestamosDe = new Map<string, PrestamoRenov[]>();
  for (const p of presRaw ?? []) {
    const arr = prestamosDe.get(p.cliente_id as string) ?? [];
    arr.push({
      id: p.id as string,
      cobrador_id: (p.cobrador_id as string | null) ?? null,
      monto_prestado: Number(p.monto_prestado),
      cuota_diaria: Number(p.cuota_diaria),
      total_dias: Number(p.total_dias),
      frecuencia: (p.frecuencia as Prestamo["frecuencia"]) ?? "diario",
      fecha_inicio: p.fecha_inicio as string,
    });
    prestamosDe.set(p.cliente_id as string, arr);
  }

  // Total pagado por crédito activo en UNA sola RPC (antes: getPagosDePrestamo
  // por cada uno de ~2.226 clientes con crédito → N+1). El cartón solo usa la
  // suma, así que basta un pago sintético con el total.
  const activos = await getActivosConPagos(db);
  const pagadoDe = new Map<string, number>();
  // pagosDeActivo es transición-safe: usa `pagado` (RPC nueva) o suma `pagos` (vieja).
  for (const a of activos) pagadoDe.set(a.id, pagosDeActivo(a).reduce((s, p) => s + p.monto, 0));

  const hoyCal = hoyUY(hoy);

  // 1) Pre-candidatos con cálculo BARATO (cartón desde la suma pagada), sin score.
  interface Pre {
    cliente: Cliente;
    prestamo: PrestamoRenov;
    progresoPct: number;
    completo: boolean;
    cuotasFaltantes: number;
  }
  const pre: Pre[] = [];
  for (const cliente of clientes) {
    // Evaluamos CADA crédito activo del cliente (no solo uno): un multi-crédito
    // puede tener un crédito avanzado listo para renovar y otro recién arrancado.
    for (const prestamo of prestamosDe.get(cliente.id) ?? []) {
      const pagos = [{ dia_credito: 1, monto: pagadoDe.get(prestamo.id) ?? 0 }];
      const r = calcularEstadosCarton(prestamo, pagos, hoyCal);
      if (r.progresoPct / 100 < umbral) continue; // aún lejos de renovar
      const cuotasCubiertas = r.dias.filter((d) => d.estado === "pagado").length;
      pre.push({
        cliente,
        prestamo,
        progresoPct: r.progresoPct,
        // MISMO umbral que el gate del server (crearRenovacion: falta >= 1
        // traba): un crédito importado con cuota fraccionaria (351,04 × 24)
        // queda con falta 0,96 incobrable — con `=== 0` la UI lo dejaba
        // "a 1 cuota de terminar" sin botón de renovar PARA SIEMPRE.
        completo: r.falta < 1,
        cuotasFaltantes: Math.max(0, prestamo.total_dias - cuotasCubiertas),
      });
    }
  }

  // 2) BÚSQUEDA antes del corte. Sin esto, el `slice(limite)` de abajo dejaba
  //    fuera del alcance a todo el que no estuviera entre los 60 más avanzados,
  //    y no había manera de llegar a él (la página no tenía filtro).
  const termino = normalizar(q ?? "");
  const filtrados = termino
    ? pre.filter(
        (p) =>
          normalizar(p.cliente.nombre).includes(termino) ||
          normalizar(p.cliente.documento ?? "").includes(termino),
      )
    : pre;

  // 3) Los más avanzados primero; el SCORE histórico (caro: 1 + N queries por
  //    cliente) se calcula SOLO para los top `limite` → evita cientos de N+1.
  filtrados.sort((a, b) => b.progresoPct - a.progresoPct);
  const top = filtrados.slice(0, limite);

  // 4) Score en paralelo (bounded a `limite`).
  const candidatos: CandidatoRenovacion[] = await Promise.all(
    top.map(async (p): Promise<CandidatoRenovacion> => {
      const historial = await getHistorialCrediticio(db, p.cliente.id);
      const score = calcularScore({ ...historial, hoy: hoyCal });
      return {
        cliente: p.cliente,
        progresoPct: p.progresoPct,
        completo: p.completo,
        cuotasFaltantes: p.cuotasFaltantes,
        score,
        moroso: false,
        prestamoAnterior: {
          id: p.prestamo.id,
          monto: p.prestamo.monto_prestado,
          cuota: p.prestamo.cuota_diaria,
          totalDias: p.prestamo.total_dias,
          frecuencia: p.prestamo.frecuencia,
          cobradorId: p.prestamo.cobrador_id,
        },
      };
    }),
  );

  // 5) Marca de moroso de cada candidato (aviso al renovar). Degrada si falta 0027.
  const ids = candidatos.map((c) => c.cliente.id);
  if (ids.length > 0) {
    const { data } = await db.from("clientes").select("id, moroso").in("id", ids);
    const marca = new Map((data ?? []).map((r) => [r.id as string, Boolean(r.moroso)]));
    for (const c of candidatos) c.moroso = marca.get(c.cliente.id) ?? false;
  }

  // `ocultos` alimenta el aviso de la página: que el gestor SEPA que hay más
  // gente esperando renovación de la que está viendo (antes se cortaba mudo).
  return {
    candidatos, // ya vienen ordenados por progreso (top `limite`)
    totalQueCalifican: filtrados.length,
    ocultos: Math.max(0, filtrados.length - candidatos.length),
  };
}

// ── ALTA REAL del crédito de renovación (escribe dinero) ───────────────────

/** Términos que confirma el gestor para el nuevo crédito. */
export interface AltaRenovacion {
  clienteId: string;
  prestamoAnteriorId: string;
  /** Capital del nuevo crédito (UYU). */
  monto: number;
  /** Cantidad de cuotas del nuevo crédito. */
  totalDias: number;
  /** Frecuencia de las cuotas del nuevo crédito. */
  frecuencia: import("@/types/db").FrecuenciaPrestamo;
  /** usuarios.id del gestor que da el alta (auditoría). */
  creadoPor: string | null;
  /** Deja pasar un monto POR ENCIMA del CAP de $100.000. Solo lo activa el camino
   *  de APROBACIÓN DEL ADMIN (`aprobarSolicitud`), nunca un alta directa ni la
   *  calle: para los créditos heredados que ya venían por encima del tope, la
   *  única alternativa era rebajarles el capital al cliente. La autorización es
   *  explícita, de una persona, y queda en auditoría. */
  permitirSobreCap?: boolean;
}

export type ResultadoAlta =
  | { ok: true; prestamoId: string; cuota: number }
  | { ok: false; error: string };

/**
 * Crea el crédito de renovación de forma segura:
 *  1. valida que el crédito anterior exista, sea del cliente, esté ACTIVO y
 *     SALDADO (falta === 0) — no se renueva por encima de un saldo pendiente;
 *  2. finaliza el crédito anterior. El gate `.eq("estado","activo")` del finalize
 *     es lo que evita renovaciones dobles del MISMO crédito (0037 permite
 *     multi-crédito por cliente: NO hay constraint de "un activo por cliente");
 *  3. inserta el nuevo crédito arrastrando la tasa del anterior (la cuota se
 *     calcula en el servidor: el cliente no puede alterar el dinero).
 * Si el insert falla, revierte el finalizado (compensación) para no dejar al
 * cliente sin crédito activo. Corre con la sesión del gestor (RLS lo exige).
 */
/**
 * Traduce los códigos de `renovar_credito_seguro` a algo que el cobrador pueda
 * ACTUAR, parado frente al cliente. Antes los cuatro caían en el mismo
 * "No se pudo crear el crédito de renovación." y no había forma de saber si
 * entregar la plata, esperar, o llamar a alguien.
 */
function mensajeRpc(code: string | undefined): string {
  switch (code) {
    case "P0412":
      // El gate de TS mira Σ pagos vigentes y la RPC mira `pagado_acum`: si
      // divergen sub-peso, el crédito aparece en "Renovar" y la base lo frena.
      return "La oficina todavía ve saldo pendiente en ese crédito. NO le entregues la plata: avisá a tu supervisor para que lo revise.";
    case "P0411":
      return "Ese monto pasa el tope del sistema. Pedilo a la oficina desde la pantalla de renovar.";
    case "P0410":
      return "Ese crédito ya fue renovado. Revisá la ficha del cliente antes de entregar nada.";
    case "P0002":
      return "No encontramos ese crédito. Cerrá y volvé a abrir la lista; si sigue, avisá a tu supervisor.";
    default:
      return "No se pudo crear la renovación. Probá de nuevo; si vuelve a fallar, avisá a tu supervisor ANTES de entregar la plata.";
  }
}

export async function crearRenovacion(
  db: SupabaseClient,
  input: AltaRenovacion,
  hoy: Date = new Date(),
  // Cliente ELEVADO para la única escritura que exige service_role: la
  // compensación (resucitar el anterior), vetada para los roles de API por 0126.
  // Inyectable para que los tests sigan sin tocar infra; en producción, si no
  // viene, se crea el admin real recién EN el punto de uso (lazy).
  adminDb?: SupabaseClient,
): Promise<ResultadoAlta> {
  const { clienteId, prestamoAnteriorId, monto, totalDias, frecuencia, creadoPor } = input;
  const FREQ = ["diario", "semanal", "quincenal", "mensual"];

  // 1. Validaciones (antes de tocar nada).
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  // CAP total (money-critical): ningún crédito supera $100.000 por las vías
  // normales — alta directa, calle, o admin excediendo el tope del tramo. La
  // ÚNICA excepción es una solicitud que el admin aprueba a mano
  // (`permitirSobreCap`), que existe para los créditos heredados de Disapp que ya
  // venían por encima: sin eso, "renovar" les rebajaba el capital al cliente.
  if (!input.permitirSobreCap && monto > RENOVACION_CAP_TOTAL)
    return { ok: false, error: `El crédito no puede superar $${RENOVACION_CAP_TOTAL.toLocaleString("es-UY")} (tope máximo).` };
  if (!(Number.isInteger(totalDias) && totalDias > 0))
    return { ok: false, error: "La cantidad de cuotas debe ser un entero mayor a 0." };
  if (!FREQ.includes(frecuencia))
    return { ok: false, error: "Frecuencia inválida." };

  const ant = await getPrestamoPorId(db, prestamoAnteriorId);
  if (!ant || ant.cliente_id !== clienteId || ant.estado !== "activo")
    return { ok: false, error: "El crédito anterior no está activo." };

  const pagos = await getPagosDePrestamo(db, ant.id);
  const r = calcularEstadosCarton(ant, pagos, hoyUY(hoy));
  // SALDADO para renovar = no queda NI UN PESO cobrable. Con una cuota importada
  // FRACCIONARIA (ej. 8425/24 = 351,04) los pagos se registran ENTEROS (351) → al
  // completar las 24 cuotas queda un residuo AGREGADO = (cuota − round(cuota)) ×
  // días que NO está acotado a 0,5 (ej. 0,04 × 24 = 0,96; con más días/otra fracción
  // puede ser varios pesos). Ese residuo sub-peso es INCOBRABLE (registrarPago
  // redondea → no se puede cobrar 0,96) y con el gate viejo `Math.round(falta) > 0`
  // (que bloquea desde falta ≥ 0,5) trababa la renovación de un crédito ya pagado
  // PARA SIEMPRE. Ahora solo se exige saldar si falta ≥ 1 peso (cobrable de verdad).
  // Para cuota ENTERA (el piloto) `falta` es entero → `>= 1` ≡ `> 0`: NO cambia nada.
  // NO toca el núcleo del cartón: es solo el umbral de permiso de la renovación.
  if (r.falta >= 1)
    return { ok: false, error: "El crédito actual todavía no está saldado." };

  // La cuota arrastra la tasa del crédito anterior (mismo cálculo que el form).
  const cuota = calcularCuotaRenovacion(
    { monto: ant.monto_prestado, cuota: ant.cuota_diaria, totalDias: ant.total_dias },
    monto,
    totalDias,
  );
  if (!(cuota > 0))
    return { ok: false, error: "La cuota calculada es inválida (revisar monto/días)." };

  // El crédito nuevo arranca el PRÓXIMO día de cobro: la plata se entrega hoy y
  // se empieza a pagar mañana. Con la fecha de hoy, la cuota 1 vencía el mismo día
  // en que el cliente recibía el dinero (reporte de campo del día 2).
  const fechaInicio = toIso(proximoDiaCobro(hoyUY(hoy)));

  // 2+3. Camino ATÓMICO (RPC 0087): finaliza el anterior + inserta el nuevo en UNA
  //      transacción → o commitean los dos o ninguno. Cierra la ventana donde el
  //      cliente quedaba sin crédito activo (server muerto entre los dos pasos) y la
  //      compensación que podía fallar. El gate `estado='activo'` + advisory lock del
  //      RPC serializan dos renovaciones concurrentes del mismo crédito. Si la 0087 aún
  //      no corrió (42883/PGRST202), cae al camino de 2 requests de abajo (sin regresión).
  const rpc = await db.rpc("renovar_credito_seguro", {
    p_prestamo_anterior_id: ant.id,
    p_cliente_id: clienteId,
    p_monto: monto,
    p_cuota: cuota,
    p_total_dias: totalDias,
    p_frecuencia: frecuencia,
    p_fecha_inicio: fechaInicio,
    p_creado_por: creadoPor,
    // El parámetro SOLO viaja cuando el admin autorizó por encima del tope (0135).
    // Se manda condicionalmente a propósito: si la 0135 todavía no corrió, la
    // renovación NORMAL sigue llamando a la firma vieja y conserva su atomicidad;
    // solo el caso excepcional cae al camino de 2 requests. Mandarlo siempre haría
    // que TODAS las renovaciones no encontraran la función (PGRST202) y perdieran
    // la transacción única.
    ...(input.permitirSobreCap ? { p_permitir_sobre_cap: true } : {}),
  });
  if (!rpc.error && rpc.data) {
    return { ok: true, prestamoId: (rpc.data as { id: string }).id, cuota };
  }
  if (rpc.error) {
    const code = (rpc.error as { code?: string }).code;
    // El gate del RPC vio el anterior ya finalizado → otra persona lo renovó primero.
    if (code === "P0410")
      return { ok: false, error: "El crédito anterior ya fue renovado por otra persona." };
    // ⚠️ P0411 = la RPC VIVA tiene su propio CAP duro (`if p_monto > 100000`), que no
    // conoce la aprobación del admin. Sin esto, `permitirSobreCap` era letra muerta:
    // el cobrador mandaba el pedido, el admin tocaba "Aprobar" y le salía un rojo
    // genérico, para siempre (3 clientes saldados hoy, $385.000 — dos del piloto).
    // Cuando el admin YA autorizó, se cae al camino de 2 requests de abajo, que no
    // tiene ese tope y aplica los mismos gates (anterior activo, saldado, del cliente).
    // No se afloja nada para el resto: sin `permitirSobreCap`, P0411 sigue siendo un
    // rechazo. La vía definitiva es agregarle el parámetro a la RPC (DDL de Carlos).
    const capAutorizado = input.permitirSobreCap === true && code === "P0411";
    if (!capAutorizado && code !== "42883" && code !== "PGRST202") {
      const ya = await buscarRenovacion(db, { clienteId, monto, cuota, totalDias, fechaInicio, prestamoAnteriorId });
      if (ya) return { ok: true, prestamoId: ya, cuota };
      // Un rojo sin motivo, frente al cliente, es un callejón sin salida: el
      // cobrador no sabe si entregar la plata ni a quién llamar. Cada código dice
      // qué pasó y qué hacer.
      return { ok: false, error: mensajeRpc(code) };
    }
    // 42883 / PGRST202 → la 0087 no está: sigue al camino de 2 requests (conducta previa).
  }

  // ── FALLBACK (0087 sin correr): 2 requests + compensación (conducta previa) ──
  // 2. Finalizar el anterior (solo si sigue activo: evita doble renovación).
  const fin = await db
    .from("prestamos")
    .update({ estado: "finalizado", finalizado_en: new Date().toISOString() })
    .eq("id", ant.id)
    .eq("estado", "activo")
    .select("id");
  if (fin.error) return { ok: false, error: "No se pudo finalizar el crédito anterior." };
  if (!fin.data || fin.data.length === 0)
    return { ok: false, error: "El crédito anterior ya fue renovado por otra persona." };

  // 3. Insertar el nuevo crédito activo.
  const alta = await db
    .from("prestamos")
    .insert({
      cliente_id: clienteId,
      cobrador_id: ant.cobrador_id,
      monto_prestado: monto,
      cuota_diaria: cuota,
      total_dias: totalDias,
      frecuencia,
      fecha_inicio: fechaInicio,
      estado: "activo",
      creado_por: creadoPor,
      renovado_de: ant.id, // linaje (0116): el nuevo apunta al que renovó
    })
    .select("id")
    .single();

  if (alta.error || !alta.data) {
    // El insert falló... PERO pudo haber COMMITEADO y perderse la respuesta (timeout
    // de la función serverless / 504 / corte de red). VERIFICAR antes de compensar: si
    // el crédito nuevo YA existe, el commit fue exitoso → devolver OK sin reactivar el
    // anterior. Sin esto, la compensación reactivaba el anterior mientras el nuevo YA
    // estaba creado → cliente con DOS créditos activos (capital/deuda DUPLICADOS) + el
    // reintento fabricaba un tercero. Se busca el crédito EXACTO que intentamos crear.
    const ya = await buscarRenovacion(db, { clienteId, monto, cuota, totalDias, fechaInicio, prestamoAnteriorId });
    if (ya) {
      // El insert había commiteado: la renovación está hecha. NO compensar (evita el duplicado).
      return { ok: true, prestamoId: ya, cuota };
    }
    // Compensación real: el nuevo NO se creó → reactivar el anterior para no dejar
    // al cliente sin crédito. (El reintento verá el anterior activo y lo renueva bien.)
    // Con el cliente ADMIN: resucitar un crédito (finalizado→activo) está vetado
    // para los roles de API desde 0126 — la máquina de estados solo avanza. Esta
    // compensación es EL caso legítimo de vuelta atrás, y por eso va por la vía
    // de confianza (service_role), no por la sesión del gestor.
    const comp = await (adminDb ?? createSupabaseAdmin())
      .from("prestamos")
      .update({ estado: "activo", finalizado_en: null })
      .eq("id", ant.id);
    if (comp.error) {
      // La reversión NO cerró: el cliente quedó SIN crédito activo (el anterior
      // finalizado y el nuevo sin crear). Deja rastro para arreglo manual — sin esto
      // era una pérdida de estado SILENCIOSA (el reintento fallaría "no está activo").
      reportarError("crearRenovacion.compensacion", comp.error, {
        clienteId,
        prestamoAnteriorId: ant.id,
      });
    }
    return { ok: false, error: "No se pudo crear el crédito; se revirtió el cambio." };
  }

  return { ok: true, prestamoId: alta.data.id as string, cuota };
}

/**
 * Busca el crédito EXACTO que una renovación intentó crear (mismo cliente, monto,
 * cuota, días y fecha de inicio, aún activo). Confirma el caso COMMIT-PERDIDO: el
 * insert commiteó pero la respuesta se perdió (timeout/504) → devolvemos el crédito
 * existente en vez de compensar/fallar y fabricar un duplicado. Devuelve su id o null.
 */
async function buscarRenovacion(
  db: SupabaseClient,
  k: {
    clienteId: string;
    monto: number;
    cuota: number;
    totalDias: number;
    fechaInicio: string;
    prestamoAnteriorId: string;
  },
): Promise<string | null> {
  const { data } = await db
    .from("prestamos")
    .select("id")
    // ⚠️ EL LINAJE ES LA CLAVE, no el parecido de términos. Buscar por (cliente,
    // monto, cuota, cuotas, fecha) matchea a un crédito HERMANO: 85 grupos / 177
    // créditos activos comparten esos cuatro valores (SONIA TELIS tiene 4 de
    // $15.000×30 y 3 de $30.000×30). Si la RPC fallaba por red, esta búsqueda
    // devolvía el hermano y la app contestaba "Listo ✓ · cuota $1.200": el
    // cobrador entregaba $30.000 por un crédito que nunca se creó, y esa plata no
    // quedaba registrada en ningún lado. `renovado_de` (0116) identifica exacto
    // al crédito que ESTA renovación intentó crear.
    .eq("renovado_de", k.prestamoAnteriorId)
    .eq("cliente_id", k.clienteId)
    .eq("estado", "activo")
    .eq("monto_prestado", k.monto)
    .eq("cuota_diaria", k.cuota)
    .eq("total_dias", k.totalDias)
    .eq("fecha_inicio", k.fechaInicio)
    .order("creado_en", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? (data[0].id as string) : null;
}

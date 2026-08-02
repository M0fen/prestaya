// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — RENOVACIÓN pre-aprobada (admin/supervisor).
//  Detecta clientes con el crédito por completar/completado y les corre el
//  SCORING (ya construido) para sugerir acción y monto del próximo crédito.
//  Enchufa el momento de mayor conversión con la decisión de plata.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, Prestamo } from "@/types/db";
import type { ResultadoScore } from "@/types/scoring";
import { getClientesAsignados } from "./clientes";
import { traerTodo } from "./paginado";
import { getPagosDePrestamo } from "./pagos";
import { getActivosConPagos, pagosDeActivo } from "./activos";
import { getPrestamoPorId } from "./prestamos";
import { getHistorialCrediticio } from "./scoring";
import { calcularEstadosCarton } from "@/lib/cartones";
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

/**
 * Candidatos a renovación: clientes con préstamo activo cuyo avance supera
 * `umbral` (por completar) o que ya completaron. Ordenados por el más avanzado.
 */
export async function getCandidatosRenovacion(
  db: SupabaseClient,
  hoy: Date = new Date(),
  umbral = 0.75,
  limite = 60,
): Promise<CandidatoRenovacion[]> {
  const clientes = await getClientesAsignados(db);
  if (clientes.length === 0) return [];

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
        completo: r.falta === 0,
        cuotasFaltantes: Math.max(0, prestamo.total_dias - cuotasCubiertas),
      });
    }
  }

  // 2) Los más avanzados primero; el SCORE histórico (caro: 1 + N queries por
  //    cliente) se calcula SOLO para los top `limite` → evita cientos de N+1.
  pre.sort((a, b) => b.progresoPct - a.progresoPct);
  const top = pre.slice(0, limite);

  // 3) Score en paralelo (bounded a `limite`).
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

  // 4) Marca de moroso de cada candidato (aviso al renovar). Degrada si falta 0027.
  const ids = candidatos.map((c) => c.cliente.id);
  if (ids.length > 0) {
    const { data } = await db.from("clientes").select("id, moroso").in("id", ids);
    const marca = new Map((data ?? []).map((r) => [r.id as string, Boolean(r.moroso)]));
    for (const c of candidatos) c.moroso = marca.get(c.cliente.id) ?? false;
  }

  return candidatos; // ya vienen ordenados por progreso (top `limite`)
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
export async function crearRenovacion(
  db: SupabaseClient,
  input: AltaRenovacion,
  hoy: Date = new Date(),
): Promise<ResultadoAlta> {
  const { clienteId, prestamoAnteriorId, monto, totalDias, frecuencia, creadoPor } = input;
  const FREQ = ["diario", "semanal", "quincenal", "mensual"];

  // 1. Validaciones (antes de tocar nada).
  if (!(monto > 0)) return { ok: false, error: "El monto debe ser mayor a 0." };
  // CAP total DURO (money-critical): ningún crédito supera $100.000, sin importar
  // el rol ni la ruta (alta directa, admin sobre-tope, o solicitud aprobada).
  if (monto > RENOVACION_CAP_TOTAL)
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

  const fechaInicio = toIso(hoyUY(hoy));

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
  });
  if (!rpc.error && rpc.data) {
    return { ok: true, prestamoId: (rpc.data as { id: string }).id, cuota };
  }
  if (rpc.error) {
    const code = (rpc.error as { code?: string }).code;
    // El gate del RPC vio el anterior ya finalizado → otra persona lo renovó primero.
    if (code === "P0410")
      return { ok: false, error: "El crédito anterior ya fue renovado por otra persona." };
    // RPC presente pero falló por otra causa. Como todo el RPC es atómico, no hay estado
    // a medias que compensar; PERO pudo haber COMMITEADO y perderse la respuesta
    // (timeout/504) → verificar si el nuevo crédito YA existe antes de reportar fallo.
    if (code !== "42883" && code !== "PGRST202") {
      const ya = await buscarRenovacion(db, { clienteId, monto, cuota, totalDias, fechaInicio });
      if (ya) return { ok: true, prestamoId: ya, cuota };
      return { ok: false, error: "No se pudo crear el crédito de renovación." };
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
    const ya = await buscarRenovacion(db, { clienteId, monto, cuota, totalDias, fechaInicio });
    if (ya) {
      // El insert había commiteado: la renovación está hecha. NO compensar (evita el duplicado).
      return { ok: true, prestamoId: ya, cuota };
    }
    // Compensación real: el nuevo NO se creó → reactivar el anterior para no dejar
    // al cliente sin crédito. (El reintento verá el anterior activo y lo renueva bien.)
    const comp = await db
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
  k: { clienteId: string; monto: number; cuota: number; totalDias: number; fechaInicio: string },
): Promise<string | null> {
  const { data } = await db
    .from("prestamos")
    .select("id")
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

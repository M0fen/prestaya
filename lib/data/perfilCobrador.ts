// ─────────────────────────────────────────────────────────────────────────
//  PERFIL OPERATIVO DE UN COBRADOR — la ficha que abre el gestor.
//
//  Antes el "perfil" era un modal con documento, teléfono y fechas: no decía
//  NADA del status real de la persona. Acá se arma el estado vivo: el recorrido
//  que está haciendo hoy (parada por parada, con hora y GPS), cómo viene la
//  plata (recaudado vs esperado, base, gastos, qué debería tener en mano), su
//  paso por el campo y sus números del período.
//
//  ⚠️ REGLA: la ruta se calcula con los MISMOS helpers puros que usa la app del
//  cobrador (`cuotaObjetivoHoy` + `clasificarClienteRuta` de ruta.ts). Si acá se
//  recalculara "a mano", el panel y el teléfono mostrarían cuentas distintas del
//  mismo día — y el que rinde plata es el cobrador. Una sola verdad.
// ─────────────────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrecuenciaPrestamo } from "@/types/db";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { inicioDiaUYIso, hoyUY, fechaISOUY } from "@/lib/fecha";
import { plazoVencido, totalCredito } from "@/lib/cartones";
import { evaluarZona } from "@/lib/geo";
import { objetivoDelDia, clasificarClienteRuta, type CreditoRuta, type EstadoHoy, type Arqueo } from "./ruta";
import { getEstadoJornada, getDeudaRendicionAyer, type EstadoJornada } from "./rendicion";
import { getGastosCobradorHoy, type GastoRuta } from "./gastos";
import { getResumenBitacoraDia, type ResumenCobradorDia } from "./bitacora";
import { getMisNumeros, type MisNumeros } from "./misNumeros";
import { conTimeout } from "@/lib/timeout";

/** Una parada del recorrido de hoy: el cliente y qué pasó con él. */
export interface ParadaRuta {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  /** Posición en el recorrido que el cobrador se armó (null = sin ordenar). */
  orden: number | null;
  /** Cuota-objetivo de HOY (créditos en término). */
  cuota: number;
  /** Deuda VIEJA todavía cobrable de este cliente. Va aparte de la cuota —la meta
   *  del día es solo lo que vence hoy— pero es plata real: sin mostrarla, el que
   *  solo debe atrasado se ve con $0 y la ficha ni imprime su línea. */
  atraso: number;
  /** Cobrado hoy hacia esa cuota. */
  pagadoHoy: number;
  estadoHoy: EstadoHoy;
  sinCuotaHoy: boolean;
  plazoVencido: boolean;
  recuperadoHoy: number;
  /** ISO del último cobro NATIVO de hoy a este cliente (null si no le cobró en la app). */
  cobradoEn: string | null;
  /** ¿El cobro se hizo cerca de la casa del cliente? null = sin GPS para comparar. */
  enZona: boolean | null;
}

export interface PersonaPerfil {
  id: string;
  nombre: string;
  apodo: string | null;
  rol: string;
  activo: boolean;
  esDev: boolean;
  telefono: string | null;
  documento: string | null;
  email: string | null;
  zonaNombre: string | null;
  comisionPct: number;
  /** Puso su propia contraseña (onboarding día 1). null = sigue con la de arranque. */
  claveCambiadaEn: string | null;
  ultimoAccesoIso: string | null;
  creadoEnIso: string;
}

export interface PerfilCobrador {
  persona: PersonaPerfil;
  /** Cuentas del día, idénticas a las de su teléfono. */
  arqueo: Arqueo;
  paradas: ParadaRuta[];
  /** Clientes de cartera vencida (visibles para recuperar, fuera del target del día). */
  vencidos: number;
  jornada: EstadoJornada;
  gastos: { total: number; items: GastoRuta[] };
  deudaAyer: { fecha: string; monto: number; cobros: number } | null;
  /** Primer y último cobro NATIVO de hoy (ISO). Dicen si arrancó y hace cuánto se movió. */
  primerCobroIso: string | null;
  ultimoCobroIso: string | null;
  /** Su paso por el campo hoy (bitácora GPS + señales). null si no hay tabla/datos. */
  campo: ResumenCobradorDia | null;
  /** Sus números del período (quincena/mes/comisión). null si no se pudieron leer. */
  numeros: MisNumeros | null;
}

/** Nunca romper el perfil por una fuente lenta o ausente: la ficha se ve igual. */
async function suave<T>(p: PromiseLike<T>, vacio: T, etiqueta: string): Promise<T> {
  try {
    return await conTimeout(Promise.resolve(p), 8000, etiqueta);
  } catch {
    return vacio;
  }
}

/**
 * Ruta de HOY de UN cobrador cualquiera (la del panel; `getRutaCobrador` resuelve
 * la del usuario logueado por RLS y no sirve para mirar a otro). Se lee con
 * service_role y scope EXPLÍCITO por `cobrador_id` — la página que la usa está
 * gateada por rol + alcance de zona.
 */
async function rutaDeCobrador(
  cobradorId: string,
  hoy: Date,
): Promise<{ paradas: ParadaRuta[]; arqueo: Arqueo; vencidos: number; primero: string | null; ultimo: string | null }> {
  const admin = createSupabaseAdmin();
  const vacio = {
    paradas: [],
    arqueo: { esperado: 0, atrasoEsperado: 0, atrasoRecuperado: 0, recaudado: 0, recaudadoRuta: 0, cobrados: 0, abonos: 0, pendientes: 0, noPagos: 0, clientes: 0 },
    vencidos: 0,
    primero: null,
    ultimo: null,
  };

  const { data: asigRaw, error: e0 } = await admin
    .from("asignaciones")
    .select("cliente_id, orden")
    .eq("cobrador_id", cobradorId)
    .eq("activo", true);
  if (e0) throw e0;
  const cliIds = [...new Set((asigRaw ?? []).map((a) => a.cliente_id as string))];
  if (cliIds.length === 0) return vacio;

  // Recorrido elegido por el cobrador (0132): si hay varias asignaciones, gana la menor.
  const ordenDe = new Map<string, number>();
  for (const a of asigRaw ?? []) {
    const o = a.orden == null ? null : Number(a.orden);
    if (o == null || !Number.isFinite(o)) continue;
    const prev = ordenDe.get(a.cliente_id as string);
    if (prev === undefined || o < prev) ordenDe.set(a.cliente_id as string, o);
  }

  const [cliRes, presRes] = await Promise.all([
    admin
      .from("clientes")
      .select("id, nombre, telefono, direccion, gps_lat, gps_lng")
      .in("id", cliIds)
      .eq("activo", true)
      .order("nombre", { ascending: true }),
    // Solo los créditos de ESTE cobrador: si el cliente está compartido con otro
    // (legítimo), la cuota del compañero no es su target ni su plata. Mismo
    // criterio que la app del cobrador (ruta.ts) para que los números coincidan.
    admin
      .from("prestamos")
      .select("id, cliente_id, cuota_diaria, total_dias, fecha_inicio, frecuencia, pagado_acum")
      .eq("estado", "activo")
      .eq("cobrador_id", cobradorId)
      .in("cliente_id", cliIds),
  ]);
  if (cliRes.error) throw cliRes.error;
  if (presRes.error) throw presRes.error;
  const clientes = cliRes.data ?? [];
  if (clientes.length === 0) return vacio;

  const hoyMid = hoyUY(hoy);
  type CredInterno = {
    id: string; cuotaDiaria: number; totalDias: number; fechaInicio: string;
    frecuencia: FrecuenciaPrestamo; pagadoAcum: number; plazoVencido: boolean;
  };
  const creditosDe = new Map<string, CredInterno[]>();
  for (const p of presRes.data ?? []) {
    const cuota = Number(p.cuota_diaria);
    const totalDias = Number(p.total_dias);
    const pagadoAcum = Number(p.pagado_acum ?? 0);
    const frecuencia = (p.frecuencia as FrecuenciaPrestamo) ?? "diario";
    // Saldado sin finalizar → fuera de la ruta (igual que ruta.ts).
    const totalCred = totalCredito(cuota, totalDias);
    if (totalCred > 0 && pagadoAcum >= totalCred - 0.5) continue;
    const cred: CredInterno = {
      id: p.id as string,
      cuotaDiaria: cuota,
      totalDias,
      fechaInicio: p.fecha_inicio as string,
      frecuencia,
      pagadoAcum,
      plazoVencido: plazoVencido(
        { cuota_diaria: cuota, total_dias: totalDias, fecha_inicio: p.fecha_inicio as string, frecuencia },
        hoyMid,
      ),
    };
    const cid = p.cliente_id as string;
    const acc = creditosDe.get(cid);
    if (acc) acc.push(cred);
    else creditosDe.set(cid, [cred]);
  }

  const ids = [...creditosDe.values()].flat().map((c) => c.id);
  const desde = inicioDiaUYIso(hoy);
  const pagadoPorPrestamo = new Map<string, number>();
  const noPagoPrestamos = new Set<string>();
  // Último cobro NATIVO por crédito: hora real + GPS (los asientos importados
  // llevan hora de oficina y sin GPS → no dicen nada del recorrido de hoy).
  const cobroNativo = new Map<string, { iso: string; lat: number | null; lng: number | null }>();
  let primero: string | null = null;
  let ultimo: string | null = null;

  if (ids.length > 0) {
    const [pagRes, visRes] = await Promise.all([
      admin
        .from("pagos")
        .select("prestamo_id, monto, registrado_en, origen, gps_lat, gps_lng")
        .eq("anulado", false)
        .gte("registrado_en", desde)
        .in("prestamo_id", ids),
      admin
        .from("visitas")
        .select("prestamo_id, resultado")
        .gte("registrado_en", desde)
        .in("prestamo_id", ids),
    ]);
    if (pagRes.error) throw pagRes.error;
    if (visRes.error) throw visRes.error;
    for (const r of pagRes.data ?? []) {
      const pid = r.prestamo_id as string;
      pagadoPorPrestamo.set(pid, (pagadoPorPrestamo.get(pid) ?? 0) + Number(r.monto));
      if (r.origen != null) continue; // asiento de oficina: no es paso por el campo
      const iso = r.registrado_en as string;
      const prev = cobroNativo.get(pid);
      if (!prev || iso > prev.iso)
        cobroNativo.set(pid, {
          iso,
          lat: r.gps_lat == null ? null : Number(r.gps_lat),
          lng: r.gps_lng == null ? null : Number(r.gps_lng),
        });
      if (!primero || iso < primero) primero = iso;
      if (!ultimo || iso > ultimo) ultimo = iso;
    }
    for (const r of visRes.data ?? []) {
      const res = r.resultado as string;
      if (res !== "pago" && res !== "abono") noPagoPrestamos.add(r.prestamo_id as string);
    }
  }

  let esperado = 0;
  let atrasoEsperado = 0;
  let atrasoRecuperado = 0;
  let recaudado = 0;
  let recaudadoRuta = 0;
  let cobrados = 0;
  let abonos = 0;
  let noPagos = 0;
  let conRuta = 0;
  let vencidos = 0;

  const paradas: ParadaRuta[] = clientes.map((c) => {
    const cid = c.id as string;
    const creds = creditosDe.get(cid);
    const base = {
      clienteId: cid,
      nombre: (c.nombre as string) ?? "",
      telefono: (c.telefono as string | null) ?? null,
      direccion: (c.direccion as string | null) ?? null,
      orden: ordenDe.get(cid) ?? null,
    };
    if (!creds)
      return { ...base, cuota: 0, atraso: 0, pagadoHoy: 0, estadoHoy: "sin_credito" as EstadoHoy, sinCuotaHoy: false, plazoVencido: false, recuperadoHoy: 0, cobradoEn: null, enZona: null };

    const esNoPago = creds.some((x) => noPagoPrestamos.has(x.id));
    const creditos: CreditoRuta[] = creds.map((x) => {
      const pagadoHoy = pagadoPorPrestamo.get(x.id) ?? 0;
      // ⚠️ MISMA fórmula que la ruta del teléfono (`objetivoDelDia`): la META es
      // solo lo que VENCE hoy y el atraso va aparte. Cuando esto usaba
      // `cuotaObjetivoHoy` sin pasar `cuotaProgramada`, el panel del supervisor
      // mostraba $3.169.300 de meta contra los $1.216.586 del cobrador (2,6×) y el
      // ranking castigaba a cobradores que sí habían cumplido.
      const { cuotaHoy: programada, mora } = objetivoDelDia(
        { cuota: x.cuotaDiaria, totalDias: x.totalDias, fechaInicio: x.fechaInicio, frecuencia: x.frecuencia, pagadoAcum: x.pagadoAcum - pagadoHoy },
        hoyMid,
      );
      const aPedir = Math.min(x.cuotaDiaria, programada + mora);
      return {
        cuota: aPedir < 0.5 ? 0 : aPedir,
        cuotaProgramada: programada,
        pagadoHoy,
        plazoVencido: x.plazoVencido,
        alDia: programada <= 0.5 && mora <= 0.5 && x.cuotaDiaria > 0 && x.totalDias > 0 && !x.plazoVencido,
      };
    });
    const clase = clasificarClienteRuta(creditos, esNoPago);
    recaudado += clase.pagadoHoyTotal;
    if (clase.cuentaEnRuta && !clase.alDiaCronograma) {
      esperado += clase.cuotaEnTermino;
      recaudadoRuta += Math.min(clase.pagadoHoyEnTermino, clase.cuotaEnTermino);
      atrasoEsperado += clase.moraEnTermino;
      atrasoRecuperado += Math.min(
        Math.max(0, clase.pagadoHoyEnTermino - clase.cuotaEnTermino),
        clase.moraEnTermino,
      );
      conRuta += 1;
      if (clase.estadoHoy === "pagado") cobrados++;
      else if (clase.estadoHoy === "abono") abonos++;
      else if (clase.estadoHoy === "no_pago") noPagos++;
    }
    if (clase.soloVencido) vencidos++;

    // Cobro más reciente entre los créditos del cliente (hora + GPS del recorrido).
    let cob: { iso: string; lat: number | null; lng: number | null } | null = null;
    for (const x of creds) {
      const n = cobroNativo.get(x.id);
      if (n && (!cob || n.iso > cob.iso)) cob = n;
    }
    const zona = cob
      ? evaluarZona(
          { lat: cob.lat, lng: cob.lng },
          { lat: c.gps_lat == null ? null : Number(c.gps_lat), lng: c.gps_lng == null ? null : Number(c.gps_lng) },
        )
      : null;

    return {
      ...base,
      cuota: clase.cuotaEnTermino,
      // ⚠️ EL ATRASO, que el supervisor había dejado de ver. Cuando `d8792d0` partió
      // el número en dos (lo que vence hoy / lo atrasado) —correcto: la meta del día
      // es solo lo que vence hoy— en el teléfono se actualizaron las dos puntas y en
      // esta ficha una sola. El cliente que SOLO debe atrasado quedaba con cuota $0 y
      // la pantalla ni imprime la línea cuando el monto es cero. Medido: 241 clientes,
      // $1.441.830 invisibles para el supervisor, que en el teléfono del cobrador
      // salen en naranja con su monto. Ningún peso mal calculado — plata que no se ve.
      atraso: Math.round(clase.moraEnTermino),
      pagadoHoy: clase.pagadoHoyEnTermino,
      estadoHoy: clase.estadoHoy,
      sinCuotaHoy: clase.alDiaCronograma,
      plazoVencido: clase.soloVencido,
      recuperadoHoy: clase.soloVencido ? clase.pagadoHoyTotal : 0,
      cobradoEn: cob?.iso ?? null,
      enZona: zona ? zona.enZona : null,
    };
  });

  // Orden del recorrido: el que se armó el cobrador primero; el resto, alfabético.
  // Los clientes SIN crédito activo van al final: están en su cartera pero no son
  // trabajo de hoy, y arriba solo ensucian la lectura del recorrido.
  paradas.sort((a, b) => {
    const sa = a.estadoHoy === "sin_credito" ? 1 : 0;
    const sb = b.estadoHoy === "sin_credito" ? 1 : 0;
    if (sa !== sb) return sa - sb;
    const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
    const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
    return oa !== ob ? oa - ob : a.nombre.localeCompare(b.nombre);
  });

  return {
    paradas,
    arqueo: {
      esperado,
      atrasoEsperado,
      atrasoRecuperado,
      recaudado,
      recaudadoRuta,
      cobrados,
      abonos,
      pendientes: Math.max(0, conRuta - cobrados - abonos - noPagos),
      noPagos,
      clientes: conRuta,
    },
    vencidos,
    primero,
    ultimo,
  };
}

/** Ficha operativa completa de un miembro del equipo. `null` si no existe. */
export async function getPerfilCobrador(
  db: SupabaseClient,
  cobradorId: string,
  hoy: Date = new Date(),
): Promise<PerfilCobrador | null> {
  const admin = createSupabaseAdmin();
  const { data: u, error } = await admin
    .from("usuarios")
    .select("id, nombre, apodo, rol, activo, es_dev, telefono, documento, zona_id, comision_pct, clave_cambiada_en, creado_en, auth_user_id")
    .eq("id", cobradorId)
    .maybeSingle();
  if (error) throw error;
  if (!u) return null;

  const [zonaNombre, cuenta, ruta, jornada, gastos, deudaAyer, campoDia, numeros] = await Promise.all([
    u.zona_id
      ? suave(
          admin
            .from("zonas")
            .select("nombre")
            .eq("id", u.zona_id as string)
            .maybeSingle()
            .then((r) => (r.data?.nombre as string | undefined) ?? null),
          null,
          "perfil:zona",
        )
      : Promise.resolve(null),
    u.auth_user_id
      ? suave(
          admin.auth.admin
            .getUserById(u.auth_user_id as string)
            .then((r) => ({ email: r.data?.user?.email ?? null, ultimo: r.data?.user?.last_sign_in_at ?? null })),
          { email: null, ultimo: null },
          "perfil:auth",
        )
      : Promise.resolve({ email: null as string | null, ultimo: null as string | null }),
    suave(
      rutaDeCobrador(cobradorId, hoy),
      { paradas: [], arqueo: { esperado: 0, atrasoEsperado: 0, atrasoRecuperado: 0, recaudado: 0, recaudadoRuta: 0, cobrados: 0, abonos: 0, pendientes: 0, noPagos: 0, clientes: 0 }, vencidos: 0, primero: null, ultimo: null },
      "perfil:ruta",
    ),
    suave(
      getEstadoJornada(db, cobradorId, hoy),
      // Literal COMPLETO y sin `as`: el cast tapaba los campos nuevos de
      // EstadoJornada y, en cuanto "Debería tener" empezó a restar `colocado`,
      // una degradación por timeout habría pintado $NaN en el panel.
      {
        recaudado: 0,
        cobrosCantidad: 0,
        gastosHoy: 0,
        gastosRespaldadosHoy: 0,
        yaRendida: null,
        base: 0,
        baseOrigen: "sin_base",
        colocado: 0,
        creditosColocados: 0,
        disponible: false,
      } satisfies EstadoJornada,
      "perfil:jornada",
    ),
    suave(getGastosCobradorHoy(db, cobradorId, hoy), { total: 0, items: [] }, "perfil:gastos"),
    suave(getDeudaRendicionAyer(db, cobradorId, hoy), null, "perfil:deuda-ayer"),
    suave(getResumenBitacoraDia(db, fechaISOUY(hoy)), [], "perfil:campo"),
    suave(getMisNumeros(cobradorId, hoy), null, "perfil:numeros"),
  ]);

  return {
    persona: {
      id: u.id as string,
      nombre: (u.nombre as string) ?? "",
      apodo: (u.apodo as string | null) ?? null,
      rol: (u.rol as string) ?? "cobrador",
      activo: !!u.activo,
      esDev: !!u.es_dev,
      telefono: (u.telefono as string | null) ?? null,
      documento: (u.documento as string | null) ?? null,
      email: cuenta.email,
      zonaNombre,
      comisionPct: Number(u.comision_pct ?? 0),
      claveCambiadaEn: (u.clave_cambiada_en as string | null) ?? null,
      ultimoAccesoIso: cuenta.ultimo,
      creadoEnIso: u.creado_en as string,
    },
    arqueo: ruta.arqueo,
    paradas: ruta.paradas,
    vencidos: ruta.vencidos,
    jornada,
    gastos,
    deudaAyer,
    primerCobroIso: ruta.primero,
    ultimoCobroIso: ruta.ultimo,
    campo: campoDia.find((c) => c.actorId === cobradorId) ?? null,
    numeros,
  };
}

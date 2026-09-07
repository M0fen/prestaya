// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — EL ÚNICO lugar donde se deciden los TÉRMINOS de un crédito.
//
//  POR QUÉ EXISTE (Carlos, 04-09). Había CUATRO pantallas que crean créditos y
//  SEIS caminos de servidor que los persisten, cada uno con su propia copia de
//  la misma secuencia: normalizar el monto, validar las cuotas, buscar el
//  crédito de referencia, medir el techo, arrastrar la tasa, calcular la cuota,
//  elegir la fecha de inicio y armar la clave de idempotencia. Copias que
//  empezaron iguales y se fueron separando:
//
//   · "Nueva venta" NO tenía selector de formato y el crédito nacía 'diario'.
//     Ocho planes SEMANALES quedaron programados día por día: al sexto día el
//     cartón los daba por vencidos y el cliente, que venía al día, figuraba
//     moroso (corregidos el 04-09 con acta en el libro).
//   · El panel tenía el MISMO default silencioso y, además, los chips de plazo
//     siempre diarios: elegir "Semanal" dejando el 24 fabricaba un crédito de
//     24 semanas.
//   · `FormRenovacion` era la 4ª puerta y la única sin el aviso de coherencia.
//   · La conversión de formato vivía DUPLICADA y una de las copias dividía por 7
//     días calendario cuando el cobro diario avanza Lun–Sáb: pasar de diario a
//     semanal le recortaba al cliente el 25% del plazo.
//
//  La lección es siempre la misma: donde hay copias, hay una que se olvida.
//
//  QUÉ HACE ESTE MÓDULO. Recibe lo que la pantalla pidió y el crédito de
//  REFERENCIA ya leído, y devuelve UNA de tres cosas: los términos exactos con
//  los que hay que crear, la orden de mandarlo a aprobación, o el rechazo con su
//  motivo. Las diferencias entre puertas —quién puede autorizar cuánto, si lo
//  que se pasa del techo se pide o se rebota— son PARÁMETROS (`via`,
//  `autoridad`), no ramas paralelas de código.
//
//  QUÉ **NO** HACE. No lee ni escribe la base, no autentica, no revalida rutas.
//  Eso queda en cada puerta porque es legítimamente distinto: el cobrador está
//  acotado por su ruta (RLS), el gestor por su zona; la renovación finaliza el
//  crédito anterior bajo lock; la venta consolida la ruta. Este módulo decide EL
//  DINERO, que es lo que tiene que ser idéntico en las cuatro pantallas.
//
//  ⚠️ MANEJA DINERO. Puro y client-safe: la pantalla previsualiza con estas
//  mismas funciones y el servidor RESUELVE con ellas, así el formulario no puede
//  alterar la cuota. Sin float: todo pasa por Math.round.
// ─────────────────────────────────────────────────────────────────────────
import type { FrecuenciaPrestamo } from "@/types/db";
import {
  cuotasValidas,
  explicaTecho,
  montoRenovacionAutoAprobable,
  montoRenovacionSugerido,
  techoRenovacion,
  techoVentaGestor,
  techoVentaNueva,
  RENOVACION_CAP_TOTAL,
  type TerminosAnterior,
} from "@/lib/renovacion";
import { calcularCuotaCreditoNuevo, interesDeBase, INTERES_DEFECTO_PCT } from "@/lib/creditoNuevo";
import { proximoDiaCobro } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import { toIso, UYU } from "@/lib/format";
import { esUuid, opIdDeterminista } from "@/lib/idempotencia";

/** Los cuatro formatos. Única lista: las puertas la importan, no la copian. */
export const FRECUENCIAS: readonly FrecuenciaPrestamo[] = [
  "diario",
  "semanal",
  "quincenal",
  "mensual",
] as const;

export function esFrecuencia(v: unknown): v is FrecuenciaPrestamo {
  return typeof v === "string" && (FRECUENCIAS as readonly string[]).includes(v);
}

/** Rótulo del formato para la pantalla. Nunca se escribe "diario" a mano. */
export const ROTULO_FRECUENCIA: Record<FrecuenciaPrestamo, string> = {
  diario: "Diario",
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
};

/** Cómo se llama UNA cuota de este formato, para no rotular "cuota diaria" un
 *  crédito semanal (la ficha del cobrador lo hacía con los cuatro formatos). */
export const ROTULO_CUOTA: Record<FrecuenciaPrestamo, string> = {
  diario: "Cuota diaria",
  semanal: "Cuota semanal",
  quincenal: "Cuota quincenal",
  mensual: "Cuota mensual",
};

/**
 * La UNIDAD en la que avanza el crédito. Es la tabla que evita el error más
 * repetido de la app: el cartón devuelve UN ELEMENTO POR CUOTA, y contar esos
 * elementos y rotularlos "días" miente en los 783 créditos activos que no son
 * diarios — el 62,7% del capital en la calle.
 *
 * ⚠️ ÚNICA tabla: vivía copiada en tres lugares (`UNIDADES` en lib/vistaCliente,
 * `etiquetaFrec` en ColocarLista y los literales sueltos de la ficha), y la que
 * el CLIENTE ve en su teléfono decía "Semana 4/17" mientras el cobrador que lo
 * atendía leía "4 días". Las tres importan de acá.
 */
export interface UnidadDeFrecuencia {
  /** "día" · "semana" — para "Restan 5 semanas". */
  singular: string;
  /** "días" · "semanas" — para "Pagó 4 de 17 semanas". */
  plural: string;
  /** "día por día" · "semana a semana" — el ritmo, para el cartón del cliente. */
  cada: string;
  /** "Día" · "Semana" — el ordinal de una casilla: "Semana 3". */
  ord: string;
}

export const UNIDAD_FRECUENCIA: Record<FrecuenciaPrestamo, UnidadDeFrecuencia> = {
  diario: { singular: "día", plural: "días", cada: "día por día", ord: "Día" },
  semanal: { singular: "semana", plural: "semanas", cada: "semana a semana", ord: "Semana" },
  quincenal: {
    singular: "quincena",
    plural: "quincenas",
    cada: "quincena a quincena",
    ord: "Quincena",
  },
  mensual: { singular: "mes", plural: "meses", cada: "mes a mes", ord: "Mes" },
};

/** "3 semanas" / "1 semana" — concuerda el número con la unidad del formato. */
export function enUnidades(n: number, frecuencia: FrecuenciaPrestamo): string {
  const u = UNIDAD_FRECUENCIA[frecuencia];
  return `${n} ${n === 1 ? u.singular : u.plural}`;
}

/** "3 cuotas" / "1 cuota" — cuando lo que se cuenta son cuotas, no tiempo. */
export function enCuotas(n: number): string {
  return `${n} ${n === 1 ? "cuota" : "cuotas"}`;
}

// ── Los dos ejes que distinguen a las puertas ──────────────────────────────

/**
 * QUÉ operación es:
 *  · "renovacion" — repetir el crédito que el cliente terminó de pagar. Hay un
 *    crédito anterior ACTIVO y saldado que se va a finalizar. Por defecto se
 *    repite tal cual (monto, cuotas y formato del anterior).
 *  · "venta" — capital nuevo. Puede haber un crédito de REFERENCIA (el último
 *    del cliente, del que sale la tasa y el techo) pero NO se cierra: el cliente
 *    puede tener varios a la vez (regla de Carlos, 07-08).
 */
export type ViaCredito = "renovacion" | "venta";

/**
 * QUIÉN está creando:
 *  · "cobrador" — coloca SIEMPRE (regla de Carlos, 06-09: "tiene que poder
 *    hacerse de forma automática, sólo debe notificar"). Por encima de su
 *    umbral (+20% del anterior) el crédito nace igual y queda MARCADO
 *    (`sobreTechoPropio`) para que la puerta avise a supervisor y admin.
 *  · "gestor" — supervisor o admin: coloca sin umbral ni marca.
 *
 * ⚠️ HISTORIA. Hasta el 06-09 el cobrador PEDÍA por encima del +20% (nacía una
 * solicitud que aprobaba la oficina) y por encima de max(CAP, +20%) se
 * rechazaba a todos. Carlos lo cambió a "automático, solo aviso": se le dijo
 * que desaparecía el candado contra el dedazo ($20.000 tipeado $200.000) y lo
 * reafirmó. El único tope que queda es el del PRIMER crédito (no hay anterior
 * contra qué medir), que él no pidió tocar.
 */
export type Autoridad = "cobrador" | "gestor";

/** El crédito contra el que se mide todo: tasa, techo y formato sugerido. */
export interface ReferenciaCredito {
  prestamoId: string;
  /** Capital del crédito de referencia (UYU entero). */
  monto: number;
  /** Su cuota (UYU entero) — con `totalDias` da la tasa que se arrastra. */
  cuota: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
}

/**
 * Arma la referencia desde una fila de crédito, venga de donde venga
 * (`getUltimoCreditoDe`, `getPrestamoPorId`, o la fila cruda de la tabla). Es el
 * único mapeo: sin esto cada puerta copiaba su propio `{ monto, cuota,
 * totalDias }` y una se olvidaba de la frecuencia — que es justamente el campo
 * que faltaba. Devuelve `null` cuando no hay contra qué medir.
 */
export function referenciaDe(
  fila:
    | {
        prestamoId?: string;
        id?: string;
        monto?: number;
        monto_prestado?: number;
        cuota?: number;
        cuota_diaria?: number;
        totalDias?: number;
        total_dias?: number;
        frecuencia?: string | null;
      }
    | null
    | undefined,
): ReferenciaCredito | null {
  if (!fila) return null;
  const prestamoId = (fila.prestamoId ?? fila.id) as string | undefined;
  // ⚠️ NO se redondea: estos valores son de LECTURA (de ellos sale la tasa que se
  // arrastra y el techo), no el número que se guarda. La capa de datos calcula la
  // cuota con los valores CRUDOS de la base, así que redondear acá hacía que el
  // módulo y la persistencia dieran cuotas distintas por $1 en los 53 créditos
  // activos con cuota fraccionaria heredada de Disapp (ANA BETANCOURT $507,53;
  // ELIZABETH RAFFO $2.000,21). El monto nunca trae decimales, pero se trata
  // igual por la misma razón.
  //
  // El redondeo se hace donde corresponde: sobre el monto que se COLOCA
  // (`montoRenovacionSugerido`), sobre la cuota que se GUARDA
  // (`calcularCuotaCreditoNuevo`) y dentro de las funciones de techo.
  const monto = Number(fila.monto ?? fila.monto_prestado ?? 0);
  const cuota = Number(fila.cuota ?? fila.cuota_diaria ?? 0);
  const totalDias = Number(fila.totalDias ?? fila.total_dias ?? 0);
  if (!prestamoId || !(monto > 0)) return null;
  return {
    prestamoId,
    monto,
    cuota,
    totalDias,
    // El formato es obligatorio en el modelo; una fila vieja sin él es 'diario',
    // que es lo que esos créditos SON (la columna se agregó después).
    frecuencia: esFrecuencia(fila.frecuencia) ? fila.frecuencia : "diario",
  };
}

export interface PedidoCredito {
  via: ViaCredito;
  autoridad: Autoridad;
  clienteId: string;
  /** Ruta a la que va el crédito (en la calle, el propio cobrador). */
  cobradorId: string;
  /** usuarios.id de quien lo está creando (idempotencia y auditoría). */
  actorId: string;
  /** Capital pedido. `null` = repetir el de la referencia (renovar tal cual). */
  monto: number | null;
  /** Cuotas pedidas. `null` = heredar las de la referencia. */
  totalDias: number | null;
  /**
   * Formato pedido. `null` = heredar el de la referencia.
   *
   * ⚠️ En una VENTA sin referencia, `null` es un ERROR, no un default: es
   * exactamente el agujero por el que ocho planes semanales nacieron 'diario'.
   * La pantalla tiene que preguntarlo.
   */
  frecuencia: FrecuenciaPrestamo | null;
  /** Interés (%) que carga el gestor. SOLO se mira cuando no hay tasa que arrastrar. */
  interesPct?: number | null;
  referencia: ReferenciaCredito | null;
  /** Nonce del navegador para la idempotencia; si falta se deriva uno estable. */
  nonce?: string | null;
  /** "Ahora" — inyectable para los tests. */
  hoy: Date;
}

/** Los términos sellados con los que se crea el crédito. Nada se recalcula después. */
export interface TerminosCredito {
  clienteId: string;
  cobradorId: string;
  monto: number;
  /** Calculada por el SERVIDOR con la tasa de la referencia. */
  cuota: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  /** Interés total (%) que queda guardado; `null` si no se pudo derivar. */
  interesPct: number | null;
  /** "YYYY-MM-DD" — el próximo día de cobro (se entrega hoy, se paga desde mañana). */
  fechaInicio: string;
  opId: string;
  referenciaId: string | null;
  /** El formato lo eligió una persona (true) o se heredó de la referencia (false). */
  formatoExplicito: boolean;
  /** El monto supera el CAP: la capa de datos necesita saberlo para la RPC. */
  sobreCap: boolean;
  /** Un COBRADOR colocó por encima de su umbral (+20% del anterior). El crédito
   *  nace igual; la puerta tiene que AVISAR a supervisor y admin. Siempre false
   *  para un gestor y para el primer crédito. La puerta LEE la marca, no la
   *  recalcula (mismo patrón que `sobreCap`; el guardián lo exige). */
  sobreTechoPropio: boolean;
  /** El umbral contra el que se midió, para decirlo con el número en el aviso. */
  techoPropio: number;
}

export type ResolucionCredito =
  /** Crear con estos términos exactos. */
  | { via: "crear"; terminos: TerminosCredito }
  /** No se puede: el motivo ya viene redactado para la pantalla. Desde el
   *  06-09 solo lo produce el PRIMER crédito sobre el CAP (y los términos
   *  inválidos): con un anterior contra qué medir, todo monto se crea. */
  | { via: "rechazo"; error: string };

// ── El techo, en UNA tabla ─────────────────────────────────────────────────

/**
 * Los dos números que definen la política de cada puerta:
 *  · `propio` — el UMBRAL DE AVISO del cobrador (+20% del anterior). Hasta acá
 *    coloca en silencio; por encima coloca igual y se avisa a la oficina.
 *  · `maximo` — el único tope que queda: el CAP del PRIMER crédito. Con un
 *    anterior contra qué medir es `null`: NO HAY TOPE (regla de Carlos, 06-09).
 *
 * ⚠️ Hasta el 06-09 `maximo` era max(CAP, +20%) y frenaba hasta al admin — el
 * candado contra el dedazo. Carlos decidió sacarlo ("automático, solo aviso")
 * sabiendo lo que se iba. `techoRenovacion` y `techoVentaGestor` siguen
 * existiendo en lib/renovacion.ts (los rótulos y sus tests las usan) pero ya
 * no deciden nada acá.
 *
 * Antes esto estaba escrito cuatro veces con cuatro combinaciones de
 * `techoVentaNueva` / `techoVentaGestor` / `montoRenovacionAutoAprobable` /
 * `techoRenovacion`, y cada puerta elegía la suya. Acá se ve la tabla entera de
 * una y se prueba de una.
 */
export function techosDe(
  via: ViaCredito,
  autoridad: Autoridad,
  referencia: ReferenciaCredito | null,
): { propio: number; maximo: number | null } {
  // PRIMER crédito del cliente: no hay anterior contra qué medir un aumento, así
  // que el CAP es el único tope y vale igual para el cobrador y para el gestor.
  if (!referencia || !(referencia.monto > 0)) {
    return { propio: RENOVACION_CAP_TOTAL, maximo: RENOVACION_CAP_TOTAL };
  }
  const base = referencia.monto;
  // El umbral es el mismo número para los dos (así la tarjeta y el aviso dicen
  // lo mismo), pero solo el COBRADOR lleva la marca: `resolverCredito` la apaga
  // para el gestor. Renovar es CONTINUIDAD: repetir el mismo monto nunca avisa,
  // ni en un heredado de $120.000 que ya supera el CAP. La venta es capital
  // nuevo y su umbral no hereda esa excepción.
  void autoridad;
  const propio = via === "renovacion" ? montoRenovacionAutoAprobable(base) : techoVentaNueva(base);
  return { propio, maximo: null };
}

// ── La resolución ──────────────────────────────────────────────────────────

/**
 * Decide los términos del crédito, o por qué no se puede. PURO.
 *
 * Es la función que responde la pregunta de Carlos: "crear un crédito
 * equivalente por las cuatro puertas tiene que dar exactamente el mismo
 * resultado en la base". Si dos puertas difieren, difieren en `via`,
 * `autoridad` o en los gates de acceso — nunca en la plata.
 */
export function resolverCredito(p: PedidoCredito): ResolucionCredito {
  const ref = p.referencia;

  // ── 1. FORMATO. Obligatorio y explícito. ────────────────────────────────
  // Heredarlo de la referencia es legítimo (renovar es repetir), pero solo
  // cuando HAY referencia: la pantalla muestra cuál es y se puede cambiar. Sin
  // referencia y sin elección no hay default que valga — es el agujero histórico.
  if (p.frecuencia != null && !esFrecuencia(p.frecuencia)) {
    return { via: "rechazo", error: "Formato inválido." };
  }
  const frecuencia: FrecuenciaPrestamo | null = p.frecuencia ?? ref?.frecuencia ?? null;
  if (!frecuencia) {
    return {
      via: "rechazo",
      error: "Elegí el formato del crédito (diario, semanal, quincenal o mensual).",
    };
  }
  const formatoExplicito = p.frecuencia != null;

  // ── 2. CUOTAS. Heredadas o tecleadas; el tope de 366 solo rige lo tecleado. ──
  // Un heredado de Disapp puede tener 555 cuotas (PAOLA VANESSA CASTRO,
  // $1.110.000): aplicarle el tope a lo que se REPITE lo rebotaba en rojo en una
  // pantalla que ni siquiera tiene campo de cuotas.
  const totalDias = p.totalDias != null ? Math.round(Number(p.totalDias)) : (ref?.totalDias ?? 0);
  // ⚠️ QUÉ CUENTA COMO "TECLEADO". No alcanza con "vino un número": los
  // formularios PRELLENAN el campo con las cuotas del crédito anterior, así que
  // el panel manda 555 aunque el gestor no haya tocado nada. Con el proxy
  // `!= null`, renovar a PAOLA VANESSA CASTRO (555 cuotas, $1.110.000, saldada)
  // rebotaba con "máximo 366" en una pantalla donde la única salida ofrecida era
  // recortarle el plazo y subirle la cuota de $2.000 a $3.639 (+82%).
  //
  // Lo que distingue continuidad de decisión no es que venga un número, sino que
  // sea DISTINTO del que el crédito ya tenía. Repetir lo heredado es continuidad
  // de una exposición que ya existe; elegir otro plazo es una decisión nueva, y
  // solo esa lleva el tope.
  const heredadas = ref != null && totalDias === ref.totalDias;
  const tecleadas = !heredadas;
  if (!Number.isFinite(totalDias) || !cuotasValidas(totalDias, tecleadas)) {
    return {
      via: "rechazo",
      error: tecleadas
        ? "Revisá la cantidad de cuotas (máximo 366)."
        : "Los términos del crédito anterior no son válidos. Avisá a la oficina.",
    };
  }

  // ── 3. MONTO. ───────────────────────────────────────────────────────────
  // `null` = repetir el de la referencia. NO se recorta al CAP: recortar sería
  // rebajarle el capital al cliente en silencio.
  const monto =
    p.monto == null ? montoRenovacionSugerido(ref?.monto ?? 0) : Math.round(Number(p.monto));
  if (!Number.isFinite(monto) || monto <= 0) {
    return { via: "rechazo", error: "Revisá el monto." };
  }

  // ── 4. TECHO. ───────────────────────────────────────────────────────────
  const { propio, maximo } = techosDe(p.via, p.autoridad, ref);
  const conReferencia = !!(ref && ref.monto > 0);
  // El único tope que queda es el del PRIMER crédito (maximo != null solo ahí).
  // Con un anterior contra qué medir NO hay rechazo por monto: se crea y, si el
  // cobrador pasó su umbral, la puerta avisa (regla de Carlos, 06-09).
  if (maximo != null && monto > maximo) {
    return {
      via: "rechazo",
      error: `El primer crédito no puede superar ${UYU(RENOVACION_CAP_TOTAL)}.`,
    };
  }
  // La marca es SOLO del cobrador: el gestor es la oficina, no se avisa a sí mismo.
  const sobreTechoPropio = p.autoridad === "cobrador" && monto > propio;

  // ── 5. LA PLATA. Una sola fórmula para las dos vías. ────────────────────
  // `calcularCuotaCreditoNuevo` arrastra la tasa de la referencia cuando es una
  // tasa DE VERDAD (≥1%) llamando a `calcularCuotaRenovacion`, y cae al interés
  // del negocio cuando el dato viene roto del import (192 créditos al 0%). Para
  // una renovación con tasa buena da EXACTAMENTE lo mismo que llamar a
  // `calcularCuotaRenovacion` directo — que es lo que hacía la otra puerta.
  const baseTasa: TerminosAnterior | null = conReferencia
    ? { monto: ref!.monto, cuota: ref!.cuota, totalDias: ref!.totalDias }
    : null;
  const tasaHeredada = interesDeBase(baseTasa);
  // ⚠️ EL INTERÉS DEL FORMULARIO SOLO VALE PARA UN CLIENTE SIN HISTORIAL.
  //
  // La condición es HAY REFERENCIA, no HAY TASA BUENA. Son distintas y la
  // diferencia es plata: 838 clientes tienen como último crédito uno de los
  // heredados con la tasa rota del import (0%), $52,2M de referencia. Si el
  // corte se hiciera por "tasa buena", para esos 838 el formulario podría
  // imponer su propio interés —un POST con `interesPct: 3` sobre un cliente que
  // el negocio tarifa al 20%— y el servidor lo aceptaría.
  //
  // Con referencia manda su tasa; y si esa tasa viene rota, se cae al 20% del
  // negocio (nunca a lo que diga el formulario). Es lo que hacían las puertas
  // antes de unificarlas y hay que conservarlo tal cual.
  const interesPct = conReferencia
    ? (tasaHeredada ?? INTERES_DEFECTO_PCT)
    : Math.max(0, Math.min(100, Math.round(Number(p.interesPct ?? INTERES_DEFECTO_PCT))));

  const cuota = calcularCuotaCreditoNuevo(baseTasa, monto, totalDias, interesPct);
  if (!(cuota > 0)) {
    return { via: "rechazo", error: "La cuota calculada no es válida. Revisá monto y cuotas." };
  }

  // ── 6. FECHA DE INICIO. El PRÓXIMO día de cobro. ────────────────────────
  // Con la fecha de hoy, la cuota 1 vencía el mismo día en que el cliente recibía
  // el dinero y a la medianoche el cartón la pintaba atrasada (campo, día 2). Si
  // mañana es domingo, arranca el lunes.
  const fechaInicio = toIso(proximoDiaCobro(hoyUY(p.hoy)));

  // ── 7. IDEMPOTENCIA. ────────────────────────────────────────────────────
  // El nonce del navegador sobrevive al reintento del MISMO submit; sin él, una
  // clave determinista por (cliente, términos, día, actor) igual evita que un
  // doble toque coloque el capital dos veces.
  const opId = esUuid(p.nonce ?? undefined)
    ? (p.nonce as string)
    : opIdDeterminista(
        p.via === "renovacion" ? "renovacion" : "credito-nuevo",
        p.clienteId,
        monto,
        cuota,
        totalDias,
        fechaInicio,
        p.actorId,
      );

  return {
    via: "crear",
    terminos: {
      clienteId: p.clienteId,
      cobradorId: p.cobradorId,
      monto,
      cuota,
      totalDias,
      frecuencia,
      interesPct,
      fechaInicio,
      opId,
      referenciaId: ref?.prestamoId ?? null,
      formatoExplicito,
      sobreCap: monto > RENOVACION_CAP_TOTAL,
      sobreTechoPropio,
      techoPropio: propio,
    },
  };
}

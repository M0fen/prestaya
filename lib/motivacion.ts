// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — EL MENSAJE DE ARRIBA DE LA RUTA.
//
//  Por qué existe. El problema del piloto no es el cálculo: es la ADOPCIÓN. El
//  06-08 cargaron en la app 6 de 18 cobradores ($219.890 contra $702.788 en el
//  sistema viejo). Una app que no se abre no sirve para nada, por bien que sume.
//
//  Qué NO es esto. No es una frase motivacional pegada arriba. Todo lo que dice
//  sale de SUS números de HOY: cuántas paradas le quedan, cuánto lleva ganado,
//  si ya cerró. Un elogio que no se corresponde con lo que la persona sabe que
//  hizo se lee como burla, y el que lo lee todos los días lo detecta al segundo.
//
//  Las reglas que respeta (psicología del proyecto, ver la skill):
//   · FRAMING POSITIVO: se habla de lo que AVANZÓ, no de lo que debe.
//   · SIN CULPA: nunca "vas mal", "estás atrasado", "te falta mucho". Ir atrás a
//     las 4 de la tarde es normal; el mensaje empuja, no reprocha.
//   · LA PLATA DEL COBRADOR: su comisión ganada hoy es el refuerzo más honesto que
//     existe — es suya y la puede contar.
//   · UNA SOLA ACCIÓN al lado, la que corresponde a ese momento del día.
//
//  Cómo se MIDE la respuesta (que es para lo que Carlos lo pidió). Cada variante
//  tiene una `clave` estable, y el botón lleva `?d=b` en la URL, que queda escrito
//  en `eventos_uso.path`. Con eso se puede comparar, por cobrador y por día:
//  cuántos abrieron la app, cuántos tocaron el botón, y —lo que de verdad importa—
//  si suben los cobros registrados y las jornadas cerradas. Si no se mueve nada en
//  dos semanas, el banner se saca sin culpa: es un experimento, no un adorno.
//
//  PURO: sin React, sin IO, sin Date.now() implícito. Se le pasa la hora.
// ─────────────────────────────────────────────────────────────────────────

export interface EstadoDelCobrador {
  /** Primer nombre, para hablarle de vos. */
  nombre: string;
  /** Paradas de hoy (clientes con crédito en término). */
  clientes: number;
  /** Cobrados + no-pago: las paradas que ya resolvió. */
  resueltos: number;
  /** Meta del día: lo que VENCE hoy. */
  esperado: number;
  /** Cobrado hoy sobre cuotas en término. */
  recaudadoRuta: number;
  /** Atraso viejo que todavía se puede recuperar. */
  atrasoVivo: number;
  /** Comisión que ya se ganó hoy (0 si no tiene %). */
  comisionHoy: number;
  /** ¿Ya cerró la jornada? */
  yaRendida: boolean;
  /** Hora de Uruguay (0-23). */
  horaUY: number;
}

export interface Motivacion {
  /** Identifica la variante. Estable: es la clave para medir la respuesta. */
  clave:
    | "cerro"
    | "completa"
    | "completa-con-atraso"
    | "sin-vencimientos"
    | "arranque"
    | "casi"
    | "mitad"
    | "empuje-tarde"
    | "en-camino";
  emoji: string;
  titulo: string;
  cuerpo: string;
  /** Colores del bloque. */
  tono: "logro" | "aliento" | "arranque";
  cta: { texto: string; href: string } | null;
}

/** Una línea que cambia con el día para que no se lea igual todas las mañanas.
 *  Determinista (sale del día del mes): el servidor y el navegador pintan lo
 *  mismo, sin hidratación rota y sin `Math.random`. */
const CHISPAS = [
  "Cada casa que tocás es plata que vuelve.",
  "El que arranca temprano termina temprano.",
  "Paso a paso se hace la ruta.",
  "La constancia es la que paga.",
  "Hoy es un día nuevo, y la ruta también.",
  "Lo que registrás en la app es lo que después te reconocen.",
  "Nadie conoce tu ruta como vos.",
];

export function chispaDelDia(dia: number): string {
  return CHISPAS[Math.abs(Math.trunc(dia)) % CHISPAS.length];
}

const pes = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

/**
 * El mensaje de hoy para este cobrador. `null` = no hay nada honesto que decir
 * (no tiene ruta todavía): mejor no mostrar nada que inventar un ánimo de más.
 */
export function mensajeMotivacion(e: EstadoDelCobrador): Motivacion | null {
  const { clientes, resueltos, esperado, recaudadoRuta, atrasoVivo, comisionHoy } = e;
  if (clientes <= 0) return null;

  const faltan = Math.max(0, clientes - resueltos);
  const ganado = comisionHoy > 0 ? ` Llevás ${pes(comisionHoy)} ganados.` : "";

  // 1. Ya cerró: es el comportamiento que más queremos que se repita, así que se
  //    reconoce explícitamente. Cerrar la jornada es lo que menos se hace hoy
  //    (3 rendiciones en todo el piloto) y lo que más ordena la caja.
  if (e.yaRendida) {
    return {
      clave: "cerro",
      emoji: "🏁",
      titulo: `Cerraste el día, ${e.nombre}`,
      cuerpo: `Tu jornada quedó rendida y firmada.${ganado} Así es como tiene que quedar todos los días.`,
      tono: "logro",
      cta: null,
    };
  }

  // 2. Nada vence hoy (ruta de semanales, o domingo). No es un logro ni un
  //    fracaso: es información, y sin ella el cobrador cree que la app se rompió.
  if (esperado <= 0) {
    return atrasoVivo > 0
      ? {
          clave: "sin-vencimientos",
          emoji: "📅",
          titulo: "Hoy no te vence ninguna cuota",
          cuerpo: `Podés aprovechar para recuperar los ${pes(atrasoVivo)} que quedaron atrás. Todo lo que traigas hoy es ganancia.`,
          tono: "aliento",
          cta: null,
        }
      : {
          clave: "sin-vencimientos",
          emoji: "📅",
          titulo: "Hoy no te vence ninguna cuota",
          cuerpo: "Tu ruta está al día. Aprovechá para visitar y colocar.",
          tono: "logro",
          cta: { texto: "Colocar un crédito", href: "/cobrador/colocar?modo=renovar&d=b" },
        };
  }

  const completa = recaudadoRuta >= esperado;

  // 3. Cobró todo lo que vencía hoy. Se celebra — y si queda atraso se dice, sin
  //    empañar el logro: son dos cosas distintas y mezclarlas es lo que hacía que
  //    la ruta cantara "Completo ✓" con la calle llena.
  if (completa && atrasoVivo > 0) {
    return {
      clave: "completa-con-atraso",
      emoji: "💪",
      titulo: "Cobraste todo lo de hoy",
      cuerpo: `Las cuotas del día están.${ganado} Si te queda tiempo, hay ${pes(atrasoVivo)} de atraso para recuperar: eso suma aparte.`,
      tono: "logro",
      cta: null,
    };
  }
  if (completa) {
    return {
      clave: "completa",
      emoji: "🎉",
      titulo: `¡Ruta completa, ${e.nombre}!`,
      cuerpo: `Cobraste las ${clientes} cuotas que vencían hoy.${ganado}${
        e.horaUY >= 16 ? " Cerrá la jornada y quedás libre." : ""
      }`,
      tono: "logro",
      cta: e.horaUY >= 16 ? { texto: "Cerrar mi jornada", href: "/cobrador?d=b#cierre" } : null,
    };
  }

  const pct = esperado > 0 ? recaudadoRuta / esperado : 0;

  // 4. Todavía no arrancó y es temprano: el mensaje más importante del día, porque
  //    es el momento en que se decide si la app se usa o se deja en el bolsillo.
  if (resueltos === 0 && e.horaUY < 12) {
    return {
      clave: "arranque",
      emoji: "☀️",
      titulo: `Buen día, ${e.nombre}`,
      cuerpo: `Hoy tenés ${clientes} paradas por ${pes(esperado)}. Arrancá por la que te quede más cerca — la app te ordena la ruta.`,
      tono: "arranque",
      cta: { texto: "Ver mi ruta", href: "/cobrador?d=b#ruta" },
    };
  }

  // 5. Ya casi. Contar lo que FALTA cuando falta poco motiva; cuando falta mucho,
  //    desanima. Por eso solo se cuenta acá.
  if (pct >= 0.7) {
    return {
      clave: "casi",
      emoji: "🔥",
      titulo: faltan > 0 ? `Te faltan ${faltan} paradas` : "Estás terminando",
      cuerpo: `Llevás ${pes(recaudadoRuta)} de ${pes(esperado)}.${ganado} Ya casi.`,
      tono: "logro",
      cta: null,
    };
  }

  if (pct >= 0.35) {
    return {
      clave: "mitad",
      emoji: "👊",
      titulo: `Vas bien, ${e.nombre}`,
      cuerpo: `${resueltos} de ${clientes} paradas resueltas · ${pes(recaudadoRuta)} cobrados.${ganado}`,
      tono: "aliento",
      cta: null,
    };
  }

  // 6. Va atrás y es tarde. Es el momento donde un reproche apaga a cualquiera.
  //    Se le da el número que le queda y una sola cosa que hacer.
  if (e.horaUY >= 16) {
    return {
      clave: "empuje-tarde",
      emoji: "⏳",
      titulo: "Todavía hay tiempo",
      cuerpo: `Te quedan ${faltan} paradas. Lo que traigas suma, y lo que no, se recupera mañana.${ganado}`,
      tono: "aliento",
      cta: null,
    };
  }

  return {
    clave: "en-camino",
    emoji: "🚶",
    titulo: `En camino, ${e.nombre}`,
    cuerpo: `${resueltos} de ${clientes} paradas.${ganado} ${chispaDelDia(e.horaUY)}`,
    tono: "aliento",
    cta: null,
  };
}

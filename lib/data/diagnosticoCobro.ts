// ─────────────────────────────────────────────────────────────────────────
//  POR QUÉ NO ENTRÓ ESE COBRO — el diagnóstico honesto.
//
//  EL PROBLEMA. Cuando un cobro de la COLA OFFLINE no puede entrar, hasta hoy
//  el cobrador leía una de dos frases, y las dos mentían:
//
//    · «Cliente no encontrado.»
//        La RLS del cobrador (`app_cobrador_tiene_cliente`) muestra solo a los
//        clientes con una ASIGNACIÓN ACTIVA suya. Si mientras el cobro esperaba
//        señal la oficina le pasó el cliente a un compañero, la consulta vuelve
//        vacía y el cobrador lee que el cliente no existe. Existe: ya no es suyo.
//
//    · «Ese crédito ya no está activo (lo renovaron o se saldó).»
//        Un «o» que tapa cuatro casos distintos con consecuencias distintas:
//        renovado (la plata va al crédito NUEVO), saldado (no se cobra más),
//        cancelado, o sigue vivo pero ahora lo lleva otro compañero.
//
//  POR QUÉ IMPORTA. El cobrador ya tiene el efectivo del cliente en la mano. El
//  mensaje no es cosmética: decide si entrega la plata, la retiene, o llama al
//  supervisor. «No encontrado» no le dice ninguna de las tres.
//
//  CÓMO SE AVERIGUA. Justamente porque la RLS le ESCONDE la respuesta, la vía
//  normal no puede contestar. Se mira con la vía de confianza (service_role) y
//  SOLO EN EL CAMINO DE ERROR: nunca en el camino feliz, nunca para escribir,
//  nunca para dejar cobrar algo que la RLS negó. Lo que sale de acá es un MOTIVO
//  y una frase — jamás datos del compañero (ni su nombre, ni sus montos).
//
//  ⚠️ ESTO NO ES UN CANDADO. No autoriza ni bloquea nada: para cuando corre, la
//  operación YA fue rechazada. Solo explica por qué.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type MotivoNoEntra =
  /** Se lo sacaron de la ruta y HOY LO TIENE otro cobrador. */
  | "reasignado"
  /** Se lo sacaron de la ruta y no lo tiene nadie (salió de circulación). */
  | "fuera_de_ruta"
  /** El crédito se renovó: existe uno NUEVO que lo reemplaza. */
  | "renovado"
  /** El crédito terminó de pagarse. */
  | "saldado"
  /** Se cerró, no consta que lo haya renovado nadie, pero el cliente tiene OTRO
   *  crédito abierto. No se afirma cuál de las dos cosas pasó. */
  | "cerrado_hay_otro"
  /** El crédito se canceló o se dio por incobrable. */
  | "cancelado"
  /** Sigue activo, pero hoy lo lleva otro cobrador. */
  | "de_otro"
  /** No se pudo determinar (cliente inexistente, o la consulta falló). */
  | "desconocido";

export type Diagnostico = { motivo: MotivoNoEntra; mensaje: string };

/**
 * Cada motivo se cuenta en DOS partes: qué pasó, y qué hacer.
 *
 * Van separadas porque el mismo hecho pide cosas distintas según el acto. En un
 * COBRO el cobrador tiene el efectivo encima y lo primero es que no lo entregue;
 * en una VISITA («no estaba», «no tenía») no hay plata de por medio y hablar de
 * ella sería inventarle un problema. La parte de "qué pasó" es idéntica en los
 * dos casos: es la verdad, y no cambia según quién pregunte.
 */
const MOTIVOS: Record<MotivoNoEntra, { quePaso: string; conLaPlata: string }> = {
  reasignado: {
    quePaso: "Este cliente ya no está en tu ruta: se lo pasaron a otro cobrador.",
    conLaPlata:
      "No entregues esa plata todavía — avisale a tu supervisor para que la registre quien lo lleva ahora.",
  },
  // Medido sobre la base viva: de 1.323 casos que darían "ya no está en tu ruta",
  // 1.013 NO los tiene ningún otro cobrador. Decirles "se lo pasaron a otro"
  // sería cambiar una mentira por otra, y mandaría a buscar a un compañero que
  // no existe.
  fuera_de_ruta: {
    quePaso: "Este cliente ya no está en tu ruta: la oficina lo sacó y hoy no lo tiene nadie.",
    conLaPlata:
      "No entregues esa plata todavía: avisale a tu supervisor para que decida qué se hace con ella.",
  },
  renovado: {
    // Sin la palabra "plata" a propósito: la parte de "qué pasó" también se usa
    // en la VISITA, donde no hay efectivo de por medio.
    quePaso: "Este crédito se renovó: ahora corre el crédito NUEVO, no este.",
    conLaPlata:
      "Esa plata va al crédito nuevo: volvé a entrar a la ficha del cliente y cobrala ahí.",
  },
  saldado: {
    quePaso: "Este crédito ya terminó de pagarse, no queda saldo.",
    conLaPlata:
      "No lo cobres de nuevo: si el cliente igual te dio plata, dejá una nota en su ficha y avisale a tu supervisor.",
  },
  // Se dice lo que consta y NADA MÁS. Afirmar "se saldó" mandaría a no cobrar un
  // crédito que quizá sea la renovación; afirmar "se renovó" mandaría a cobrar
  // sobre uno que quizá no corresponde. Lo cierto es que hay otro abierto.
  cerrado_hay_otro: {
    quePaso: "Este crédito se cerró y el cliente tiene OTRO crédito abierto.",
    conLaPlata:
      "Antes de nada, mirá su ficha y fijate sobre cuál va el cobro. Si no te queda claro, avisale a tu supervisor.",
  },
  cancelado: {
    quePaso: "Este crédito fue dado de baja desde la oficina.",
    conLaPlata:
      "No entregues esa plata todavía: dejá una nota en la ficha del cliente y avisale a tu supervisor.",
  },
  de_otro: {
    quePaso: "Este crédito sigue activo pero ahora lo lleva otro cobrador.",
    conLaPlata:
      "No entregues esa plata todavía — avisale a tu supervisor para que la registre quien lo lleva ahora.",
  },
  // Cuando de verdad no sabemos, se conserva la frase vieja: es preferible el
  // texto genérico que ya conocen a una explicación inventada.
  desconocido: {
    quePaso: "Ese crédito ya no está activo (lo renovaron o se saldó).",
    conLaPlata:
      "No entregues esa plata todavía: dejá una nota en la ficha del cliente y avisale a tu supervisor.",
  },
};

/** `acto` = 'cobro' (hay efectivo en la mano) o 'visita' (no lo hay). */
export function mensajeDe(motivo: MotivoNoEntra, acto: "cobro" | "visita" = "cobro"): string {
  const m = MOTIVOS[motivo];
  return acto === "cobro" ? `${m.quePaso} ${m.conLaPlata}` : `${m.quePaso} Avisale a tu supervisor.`;
}

/** Forma mínima que necesita el diagnóstico. Evita atarlo al tipo completo. */
type FilaPrestamo = {
  id: string;
  estado: string;
  cobrador_id: string | null;
  renovado_de?: string | null;
  creado_en?: string | null;
};

/**
 * La REGLA PURA, sin base de datos: qué pasó, dadas las filas.
 *
 * Se separa de la consulta para poder probarla sin Supabase (y porque el orden
 * de las preguntas ES la decisión: primero la ruta, después el crédito).
 *
 * @param clienteExiste     ¿existe la ficha del cliente?
 * @param sigueEnMiRuta     ¿hay asignación ACTIVA de este cliente a este cobrador?
 * @param laTieneOtro       ¿la tiene ACTIVA algún otro cobrador?
 * @param prestamo          el crédito que se quiso cobrar (null si no se eligió uno)
 * @param prestamosCliente  todos los créditos del cliente (para hallar el renovado)
 */
export function clasificarNoEntra(args: {
  clienteExiste: boolean;
  sigueEnMiRuta: boolean;
  laTieneOtro: boolean;
  cobradorId: string | null;
  prestamo: FilaPrestamo | null;
  prestamosCliente: FilaPrestamo[];
}): MotivoNoEntra {
  const { clienteExiste, sigueEnMiRuta, laTieneOtro, cobradorId, prestamo, prestamosCliente } =
    args;

  if (!clienteExiste) return "desconocido";
  // El orden importa: si al cobrador le sacaron el cliente, ESO es lo que pasó,
  // aunque además el crédito se haya renovado. Es la causa que él puede entender
  // y la única que le dice qué hacer con la plata.
  if (!sigueEnMiRuta) return laTieneOtro ? "reasignado" : "fuera_de_ruta";

  // Sin crédito elegido: no se pudo resolver ninguno de los SUYOS. Si el cliente
  // tiene alguno activo, es de un compañero (créditos compartidos: 59 clientes).
  const objetivo =
    prestamo ??
    prestamosCliente.find((p) => p.estado === "activo") ??
    ultimoNoActivo(prestamosCliente);
  if (!objetivo) return "desconocido";

  if (objetivo.estado === "activo") {
    return cobradorId && objetivo.cobrador_id && objetivo.cobrador_id !== cobradorId
      ? "de_otro"
      : "desconocido"; // activo y suyo: no debería llegar acá.
  }

  // 'refinanciado' lo dice el propio estado. Para 'finalizado' hay que mirar si
  // NACIÓ otro crédito de éste (`renovado_de`, único desde 0156): renovar cierra
  // el viejo como finalizado, igual que saldarlo, y el cobrador necesita
  // distinguirlos — en uno la plata se mueve al crédito nuevo y en el otro no.
  if (objetivo.estado === "refinanciado") return "renovado";
  const hijo = prestamosCliente.find((p) => p.renovado_de === objetivo.id);
  if (hijo) return "renovado";
  if (objetivo.estado === "finalizado") {
    // ⚠️ El linaje solo existe para lo que creó la app: 318 de 372 renovaciones
    // nativas lo tienen, pero de los 11.466 finalizados de la base (casi todos
    // heredados de Disapp) 11.148 no tienen hijo registrado. En esos, "se
    // renovó" y "se saldó" son INDISTINGUIBLES desde acá. Si el cliente tiene
    // otro crédito abierto se dice eso —que es cierto— en vez de elegir una de
    // las dos y arriesgar el consejo contrario.
    const otroAbierto = prestamosCliente.some(
      (p) => p.id !== objetivo.id && p.estado === "activo",
    );
    return otroAbierto ? "cerrado_hay_otro" : "saldado";
  }
  return "cancelado"; // 'cancelado' e 'incobrable'
}

/** El crédito no-activo más reciente del cliente (por fecha de creación). */
function ultimoNoActivo(ps: FilaPrestamo[]): FilaPrestamo | null {
  const noActivos = ps.filter((p) => p.estado !== "activo");
  if (noActivos.length === 0) return null;
  return noActivos.reduce((a, b) => ((b.creado_en ?? "") > (a.creado_en ?? "") ? b : a));
}

/**
 * Averigua por qué no entró el cobro y devuelve la frase para el cobrador.
 *
 * NUNCA lanza: es el camino de error de un cobro que ya falló. Si la consulta se
 * cae, se devuelve la frase genérica de siempre — el cobrador no puede quedarse
 * sin ninguna respuesta porque el diagnóstico haya fallado.
 */
export async function diagnosticarNoEntra(args: {
  clienteId: string;
  prestamoId?: string | null;
  cobradorId: string | null;
  acto?: "cobro" | "visita";
}): Promise<Diagnostico> {
  const acto = args.acto ?? "cobro";
  try {
    const admin = createSupabaseAdmin();

    // Se traen TODAS las asignaciones vivas del cliente en una sola consulta: no
    // alcanza con saber que este cobrador ya no lo tiene, hay que saber si lo
    // tiene alguien más (es la diferencia entre "se lo pasaron a otro" y "hoy no
    // lo tiene nadie", que son avisos distintos).
    const [cli, asig, prestamos] = await Promise.all([
      admin.from("clientes").select("id").eq("id", args.clienteId).limit(1),
      admin
        .from("asignaciones")
        .select("cobrador_id")
        .eq("cliente_id", args.clienteId)
        .eq("activo", true),
      admin
        .from("prestamos")
        .select("id, estado, cobrador_id, renovado_de, creado_en")
        .eq("cliente_id", args.clienteId),
    ]);

    const prestamosCliente = ((prestamos as { data?: FilaPrestamo[] | null }).data ??
      []) as FilaPrestamo[];
    const enRuta = ((asig as { data?: { cobrador_id: string }[] | null }).data ??
      []) as { cobrador_id: string }[];
    const motivo = clasificarNoEntra({
      clienteExiste: (((cli as { data?: unknown[] | null }).data ?? []).length ?? 0) > 0,
      // Sin cobrador (supervisor/gestor cobrando desde el panel) no hay ruta que
      // valga: nunca es "te lo sacaron".
      sigueEnMiRuta:
        !args.cobradorId || enRuta.some((a) => a.cobrador_id === args.cobradorId),
      laTieneOtro: enRuta.some((a) => a.cobrador_id !== args.cobradorId),
      cobradorId: args.cobradorId,
      prestamo: args.prestamoId
        ? (prestamosCliente.find((p) => p.id === args.prestamoId) ?? null)
        : null,
      prestamosCliente,
    });
    return { motivo, mensaje: mensajeDe(motivo, acto) };
  } catch {
    return { motivo: "desconocido", mensaje: mensajeDe("desconocido", acto) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — CONTENIDO del tutorial in-app, por rol.
//  Núcleo PURO (sin base ni red): las guías y las reglas de quién ve qué.
//  Acceso: admin ve TODO; supervisor ve cobrador + supervisor; cobrador ve
//  solo cobrador. La función guiasPara() es la fuente de verdad de ese acceso.
//
//  Estilo: PRÁCTICO. Cada paso dice DÓNDE tocar (menú → pantalla) y QUÉ pasa.
//  Muchas guías traen un enlace para abrir la pantalla y probar ahí mismo.
// ─────────────────────────────────────────────────────────────────────────
import type { Rol } from "@/types/db";

export interface PasoTutorial {
  titulo: string;
  cuerpo: string;
  /** Consejo/aviso opcional que se resalta aparte. */
  tip?: string;
}

export interface GuiaTutorial {
  id: string;
  /** Audiencia base de la guía (cobrador / supervisor / admin). */
  rol: Rol;
  icono: string;
  titulo: string;
  resumen: string;
  pasos: PasoTutorial[];
  /** Botón para abrir la pantalla real y practicar (opcional). */
  enlace?: { href: string; texto: string };
  /** Muestra la leyenda de colores del cartón junto a la guía. */
  leyendaCarton?: boolean;
}

// ── GUÍAS DEL COBRADOR ────────────────────────────────────────────────────
const COBRADOR: GuiaTutorial[] = [
  {
    id: "cob-arranca",
    rol: "cobrador",
    icono: "🚀",
    titulo: "Arrancá acá (primeros pasos)",
    resumen: "En 3 minutos: instalá la app, cobrá al primero y cerrá el día.",
    enlace: { href: "/cobrador", texto: "Ir a mi ruta" },
    pasos: [
      {
        titulo: "1. Instalá la app en el teléfono",
        cuerpo:
          "Abrí el link en el navegador del celular y elegí 'Agregar a pantalla de inicio'. Queda como una app: abre rápido y funciona aunque te quedes sin señal un rato.",
      },
      {
        titulo: "2. Mirá tu ruta del día",
        cuerpo:
          "Al entrar ves arriba tu META del día (a cuántos clientes pasar y cuánto suman) y debajo la lista de clientes ordenada. Empezá por el primero.",
      },
      {
        titulo: "3. Cobrá y, al final, cerrá el día",
        cuerpo:
          "Tocás un cliente, cargás el pago (queda con hora y GPS). Al terminar la vuelta, tocás 'Cerrar jornada' y rendís lo cobrado. Eso es todo tu día.",
        tip: "Solo ves TUS clientes asignados. La cartera completa la ve la oficina; vos no.",
      },
    ],
  },
  {
    id: "cob-pago",
    rol: "cobrador",
    icono: "💵",
    titulo: "Registrar un pago",
    resumen: "Cargar un cobro para que quede con hora, lugar y comprobante.",
    enlace: { href: "/cobrador", texto: "Abrir mi ruta" },
    leyendaCarton: true,
    pasos: [
      {
        titulo: "Entrá a la ficha del cliente",
        cuerpo:
          "Tocá el cliente en tu ruta. Vas a ver su cartón: cada casilla es un día. Verde = pagado, ámbar = pendiente/abono, rojo = atrasado, gris = todavía no vence.",
      },
      {
        titulo: "Cargá el monto y tocá 'Registrar pago'",
        cuerpo:
          "Poné lo que te entrega y confirmá. El teléfono guarda la hora del servidor y tu ubicación (GPS): así queda la prueba de que cobraste ahí y en ese momento.",
        tip: "Un abono parcial (menos que la cuota) NO pinta el día de verde: queda ámbar (pendiente). Recién con la cuota completa el día queda pagado.",
      },
      {
        titulo: "Mostrale el comprobante",
        cuerpo:
          "Cada pago genera un comprobante con la hora y el sello 'Registrado'. El cliente lo ve desde su propio link. Es tu respaldo y el de él.",
      },
    ],
  },
  {
    id: "cob-nopago",
    rol: "cobrador",
    icono: "🚪",
    titulo: "Cuando no pagan",
    resumen: "Dejá constancia de la visita aunque no hayas cobrado.",
    enlace: { href: "/cobrador", texto: "Abrir mi ruta" },
    pasos: [
      {
        titulo: "Tocá 'No pagó' y elegí el motivo",
        cuerpo:
          "Entrá al cliente, tocá 'No pagó' y elegí: no estaba, no tenía, se negó, reagendado. Queda registrado con GPS y hora, igual que un pago.",
        tip: "Registrar el 'no pago' te PROTEGE: demuestra que pasaste. La oficina lo ve y no queda como que 'te salteaste' al cliente.",
      },
    ],
  },
  {
    id: "cob-censo",
    rol: "cobrador",
    icono: "📍",
    titulo: "Censar un cliente nuevo",
    resumen: "Dar de alta en la calle a alguien que todavía no está en el sistema.",
    enlace: { href: "/cobrador/censar", texto: "Abrir 'Censar'" },
    pasos: [
      {
        titulo: "Sacale la foto (obligatoria)",
        cuerpo:
          "En 'Censar', lo primero es la foto del cliente. Es obligatoria: sin foto no se puede dar de alta. Sirve para que no existan clientes 'fantasma'.",
      },
      {
        titulo: "Cargá los datos y capturá el GPS de la casa",
        cuerpo:
          "Nombre, documento, teléfono. Muy importante: parado en la puerta, tocá 'Capturar' para guardar la ubicación de la casa.",
        tip: "Esa ubicación es la que el sistema usa después para chequear que los cobros se hagan cerca del domicilio (geo-cerca). Sin ella, no hay control de zona.",
      },
    ],
  },
  {
    id: "cob-cierre",
    rol: "cobrador",
    icono: "🌙",
    titulo: "Cerrar la jornada (rendición)",
    resumen: "Al final del día rendís lo cobrado. Esto te cuida a vos.",
    enlace: { href: "/cobrador", texto: "Ir a mi ruta" },
    pasos: [
      {
        titulo: "Cargá tus gastos de ruta durante el día",
        cuerpo:
          "Si tuviste gastos (nafta, boleto), cargalos apenas ocurren. Se descuentan de lo que tenés que entregar.",
      },
      {
        titulo: "Tocá 'Cerrar jornada' y poné lo que entregás",
        cuerpo:
          "El sistema calcula lo esperado (lo cobrado menos tus gastos) y vos ponés lo que entregás. Si coincide, perfecto. Si hay diferencia, queda como faltante o sobrante.",
        tip: "La rendición es tu tranquilidad: deja claro cuánto entregaste y cuándo. Nadie puede decir después que faltó plata sin que figure.",
      },
    ],
  },
  {
    id: "cob-offline",
    rol: "cobrador",
    icono: "📴",
    titulo: "Cobrar sin señal",
    resumen: "En un sótano o zona sin datos, la app no te deja tirado.",
    pasos: [
      {
        titulo: "Cobrá igual: se guarda en el teléfono",
        cuerpo:
          "Si te quedás sin internet, registrá el pago normal. Queda en una cola de pendientes en el propio celular.",
      },
      {
        titulo: "Se sincroniza solo al volver la señal",
        cuerpo:
          "Cuando volvés a tener datos, la app sube los cobros guardados sola. No tenés que hacer nada.",
        tip: "No se duplican: aunque toques dos veces o vuelva la señal a mitad de camino, cada cobro entra UNA sola vez. (El censo con foto sí necesita señal.)",
      },
    ],
  },
  {
    id: "cob-chat",
    rol: "cobrador",
    icono: "💬",
    titulo: "Hablar con la oficina",
    resumen: "El chat interno para coordinar sin usar tu WhatsApp personal.",
    enlace: { href: "/cobrador/chat", texto: "Abrir el chat" },
    pasos: [
      {
        titulo: "Tus canales",
        cuerpo:
          "Tenés el canal del Equipo (todos), tu hilo privado con la Oficina, y el canal de tu Zona (vos, tu supervisor y los cobradores de tu zona).",
      },
      {
        titulo: "Es privado y queda registrado",
        cuerpo:
          "El hilo con la oficina es solo entre vos y ellos, cifrado. Sirve para avisar 'este cliente se mudó' o 'me falta cambio'.",
      },
    ],
  },
];

// ── GUÍAS DEL SUPERVISOR ──────────────────────────────────────────────────
const SUPERVISOR: GuiaTutorial[] = [
  {
    id: "sup-arranca",
    rol: "supervisor",
    icono: "🚀",
    titulo: "Arrancá acá (primeros pasos)",
    resumen: "Lo primero que mirás cada mañana como supervisor de tu zona.",
    enlace: { href: "/admin", texto: "Ir al panel" },
    pasos: [
      {
        titulo: "1. Mirá el Dashboard de tu zona",
        cuerpo:
          "El panel abre en el Dashboard: cartera, mora, recaudo y tus cobradores. TODO es de tu zona (no ves otras). Es tu foto del negocio en 5 segundos.",
      },
      {
        titulo: "2. Revisá el Centro de alertas 🚨",
        cuerpo:
          "En el menú, 'Centro de alertas' junta lo que hay que vigilar HOY: faltantes de caja, cobradores que no rindieron, 'no pago' sospechoso, cobros fuera de zona. Empezá el día por acá.",
        tip: "Abajo del todo está el ranking de CONFIANZA de tus cobradores: a menor puntaje, mirá primero a esa persona.",
      },
      {
        titulo: "3. Seguí el Cierre del día",
        cuerpo:
          "'Cierre del día' te muestra en vivo cómo va cada cobrador: recaudado vs esperado, quién ya rindió y quién falta. Es tu control de la jornada.",
      },
    ],
    // El enlace principal ya va al panel; el resto lo navega desde el menú.
  },
  {
    id: "sup-alertas",
    rol: "supervisor",
    icono: "🚨",
    titulo: "Centro de alertas y confianza",
    resumen: "Tu herramienta anti-fuga: todo lo raro del día, en un lugar.",
    enlace: { href: "/admin/alertas", texto: "Abrir Centro de alertas" },
    pasos: [
      {
        titulo: "Leé las alertas de arriba (rojas) primero",
        cuerpo:
          "Las 'altas' (rojas) son las urgentes: un cobrador entregó de menos, o marcó 'no pagó' a un cliente que siempre paga. Las 'medias' (ámbar) son para observar.",
      },
      {
        titulo: "Mirá la confianza de tus cobradores",
        cuerpo:
          "Cada cobrador tiene un puntaje 0–100 (30 días) y su cuenta corriente: cuánto recaudó, cuánto rindió y el 'sin rendir'. Si algo no cierra, ahí salta.",
        tip: "Un puntaje bajo NO acusa a nadie: dice 'prestá atención a esta persona'. Cruzá con el Control de campo (GPS) antes de sacar conclusiones.",
      },
    ],
  },
  {
    id: "sup-reasignar",
    rol: "supervisor",
    icono: "🔀",
    titulo: "Reasignar un cliente",
    resumen: "Mover un cliente de un cobrador a otro, dentro de tu zona.",
    enlace: { href: "/admin/clientes", texto: "Abrir Clientes" },
    pasos: [
      {
        titulo: "Abrí la ficha del cliente",
        cuerpo:
          "Menú → Clientes → tocá el cliente. Bajá hasta la sección 'Cobrador asignado' y elegí a quién se lo pasás en el selector.",
      },
      {
        titulo: "Solo entre tus cobradores",
        cuerpo:
          "Podés mover un cliente entre los cobradores de tu misma zona. Pasarlo a otra zona es potestad del admin.",
        tip: "Todo cambio queda auditado: quién movió a quién y cuándo.",
      },
    ],
  },
  {
    id: "sup-anular",
    rol: "supervisor",
    icono: "🚫",
    titulo: "Solicitar anular un pago (doble registro)",
    resumen: "Vos no anulás plata solo: pedís, y otra persona confirma. Anti-fraude.",
    enlace: { href: "/admin/anulaciones", texto: "Abrir Anulaciones" },
    pasos: [
      {
        titulo: "Pedí la anulación desde el pago",
        cuerpo:
          "En la ficha del cliente, en el pago que corresponda, tocá 'Solicitar anulación' y escribí el motivo. Queda pendiente.",
      },
      {
        titulo: "La confirma OTRA persona",
        cuerpo:
          "La solicitud aparece en 'Anulaciones'. La confirma el admin u otro supervisor de la zona: nunca vos mismo. Recién ahí el pago se marca anulado.",
        tip: "El pago nunca se borra: se marca anulado con quién lo pidió, quién lo confirmó y por qué. El libro de pagos es la verdad y no se toca.",
      },
    ],
  },
  {
    id: "sup-renovar",
    rol: "supervisor",
    icono: "🔄",
    titulo: "Renovaciones",
    resumen: "Vos proponés renovar un crédito; el admin lo aprueba.",
    enlace: { href: "/admin/renovaciones", texto: "Abrir Renovaciones" },
    pasos: [
      {
        titulo: "Elegí al cliente y proponé el nuevo crédito",
        cuerpo:
          "En 'Renovaciones' aparecen los que terminaron bien. Elegís uno, ponés monto y cuotas y solicitás. Si está dentro del tope (≤20% y ≤$100.000) se aprueba solo; si no, va al admin.",
      },
      {
        titulo: "Ojo con el aviso de moroso",
        cuerpo:
          "Si el cliente está marcado como moroso, te aparece el aviso para que lo tengas en cuenta antes de proponer.",
      },
    ],
  },
  {
    id: "sup-limites",
    rol: "supervisor",
    icono: "🔒",
    titulo: "Lo que no ves ni tocás (a propósito)",
    resumen: "Algunas palancas y datos quedan solo para el dueño.",
    pasos: [
      {
        titulo: "No ves los números del dueño",
        cuerpo:
          "Rentabilidad (Valor), utilidad (Informe de cartera), comisiones y reportes son del admin: no te aparecen en el menú. Tampoco datos de otras zonas.",
      },
      {
        titulo: "No cambiás reglas de plata",
        cuerpo:
          "Editar la política de mora, fijar/liquidar comisiones o anular pagos directo son del admin.",
        tip: "No es desconfianza: es separar funciones para que ninguna persona sola mueva reglas de plata. Te cuida a vos también.",
      },
    ],
  },
];

// ── GUÍAS DEL ADMIN ───────────────────────────────────────────────────────
const ADMIN: GuiaTutorial[] = [
  {
    id: "adm-arranca",
    rol: "admin",
    icono: "🚀",
    titulo: "Arrancá acá (primeros pasos)",
    resumen: "El recorrido de 5 minutos para conocer todo el panel.",
    enlace: { href: "/admin", texto: "Ir al Dashboard" },
    pasos: [
      {
        titulo: "1. Dashboard: la foto del negocio",
        cuerpo:
          "El panel abre en el Dashboard: capital en calle, recaudo de hoy/mes, mora, y el movimiento por período. Es tu tablero de mando.",
      },
      {
        titulo: "2. Definí Zonas y Equipo",
        cuerpo:
          "Menú → Zonas: creá territorios y asigná cobradores/supervisores. Menú → Equipo: das de alta usuarios. Esto es el cimiento: sin zonas, los supervisores ven todo.",
        tip: "Un supervisor SIN zona ve toda la operación (transición). Apenas le asignás una zona, queda acotado a ella.",
      },
      {
        titulo: "3. Vigilá con el Centro de alertas y Aureo",
        cuerpo:
          "'Centro de alertas' 🚨 junta las señales anti-fuga del día. Y con el botón flotante 🤖 (Aureo) preguntás en lenguaje natural: 'cómo viene la caja', 'clientes en riesgo'.",
      },
    ],
  },
  {
    id: "adm-alertas",
    rol: "admin",
    icono: "🚨",
    titulo: "Centro de alertas (anti-fuga)",
    resumen: "Todo lo que hay que vigilar hoy, priorizado, en un lugar.",
    enlace: { href: "/admin/alertas", texto: "Abrir Centro de alertas" },
    pasos: [
      {
        titulo: "La bandeja del día",
        cuerpo:
          "Faltantes de caja, cobradores que no rindieron, 'no pago' sospechoso (cliente cumplidor marcado que no pagó), cobros fuera de zona, float alto y desembolsos grandes. Rojas = urgentes.",
      },
      {
        titulo: "Confianza de cobradores + cuenta corriente",
        cuerpo:
          "Abajo, cada cobrador con su puntaje 0–100 (30 días) y su cuenta corriente: recaudó vs rindió y el 'sin rendir'. Cruzalo con Control de campo (GPS) para decidir.",
      },
    ],
  },
  {
    id: "adm-zonas",
    rol: "admin",
    icono: "🗺️",
    titulo: "Zonas y equipo: el cimiento",
    resumen: "Definí territorios y quién ve qué. Sin esto, los supervisores ven todo.",
    enlace: { href: "/admin/zonas", texto: "Abrir Zonas" },
    pasos: [
      {
        titulo: "Creá las zonas",
        cuerpo:
          "Menú → Zonas → creá cada territorio (barrio, ruta) con nombre y color para reconocerla en el mapa y los chats.",
      },
      {
        titulo: "Asigná cobradores y supervisores",
        cuerpo:
          "Cada cobrador va en UNA zona. A cada supervisor le marcás qué zonas cubre (puede cubrir varias). Desde ese momento, el supervisor solo ve esas zonas.",
        tip: "La zona del cliente sale sola del cobrador que lo atiende: no se la asignás a mano.",
      },
    ],
  },
  {
    id: "adm-juego",
    rol: "admin",
    icono: "🎮",
    titulo: "Premios y juegos (raspadita por scoring)",
    resumen: "Premiá distinto según lo cumplidor que sea el cliente.",
    enlace: { href: "/admin/promos", texto: "Abrir Juegos y sorteos" },
    pasos: [
      {
        titulo: "Definí los tramos de scoring",
        cuerpo:
          "Cada tramo es un rango de score (%) con su 'probabilidad de ganar'. Ej: 'Clientes estrella' 90–100% → gana 100% (siempre saca premio, aunque igual raspa). 'Los demás' → el % que quieras.",
      },
      {
        titulo: "Asigná premios a cada tramo",
        cuerpo:
          "Cargá los premios (beneficios simbólicos, sin dinero) y ponelos en su tramo. Al ganar, se sortea cuál por su 'peso'. El servidor decide: no se puede trucar.",
        tip: "El tramo VIP debe tener al menos un premio asignado, si no el cliente 'gana' pero se queda sin nada.",
      },
    ],
  },
  {
    id: "adm-anulaciones",
    rol: "admin",
    icono: "🚫",
    titulo: "Anular pagos y confirmar solicitudes",
    resumen: "Vos anulás directo; también confirmás lo que piden los supervisores.",
    enlace: { href: "/admin/anulaciones", texto: "Abrir Anulaciones" },
    pasos: [
      {
        titulo: "Anular directo",
        cuerpo:
          "En la ficha del cliente, en un pago, tocás 'Anular', escribís el motivo y listo. El pago queda anulado (no se borra) con tu firma.",
      },
      {
        titulo: "Confirmar solicitudes (doble registro)",
        cuerpo:
          "En 'Anulaciones' ves lo pendiente. No podés confirmar una solicitud que pediste vos: siempre son dos personas distintas.",
      },
    ],
  },
  {
    id: "adm-scoring",
    rol: "admin",
    icono: "🧮",
    titulo: "Scoring crediticio configurable",
    resumen: "Vos definís cómo se puntúa a los clientes.",
    enlace: { href: "/admin/scoring", texto: "Abrir Scoring" },
    pasos: [
      {
        titulo: "Ajustá los pesos y umbrales",
        cuerpo:
          "Menú → Scoring: movés cuánto pesa cada factor (cumplimiento, mora, experiencia, consistencia, antigüedad) y los cortes de cada banda.",
      },
      {
        titulo: "Se recalcula solo",
        cuerpo:
          "El score no se guarda: se calcula del historial real. Al cambiar el modelo, todos se re-puntúan al instante. La evolución de cada cliente está en su ficha.",
      },
    ],
  },
  {
    id: "adm-mora-comisiones",
    rol: "admin",
    icono: "⚙️",
    titulo: "Mora y comisiones",
    resumen: "Las reglas de plata que solo vos manejás.",
    enlace: { href: "/admin/comisiones", texto: "Abrir Comisiones" },
    pasos: [
      {
        titulo: "Política de mora",
        cuerpo:
          "Menú → Mora: configurás el recargo por atraso. Se aplica parejo y trazable, no a ojo.",
      },
      {
        titulo: "Comisiones de cobradores",
        cuerpo:
          "Menú → Comisiones: fijás el % por cobrador y liquidás; la liquidación impacta en caja. El supervisor lo ve pero no lo cambia.",
      },
    ],
  },
  {
    id: "adm-control",
    rol: "admin",
    icono: "🛰️",
    titulo: "Control de campo y auditoría",
    resumen: "Cada acción con GPS, hora y un log que no se puede editar.",
    enlace: { href: "/admin/campo", texto: "Abrir Control de campo" },
    pasos: [
      {
        titulo: "Bitácora y score de sospecha",
        cuerpo:
          "En 'Control de campo' ves los movimientos de cada cobrador con GPS y hora del servidor. Un score marca patrones raros (planchar, cobrar fuera de zona, sin moverse).",
      },
      {
        titulo: "Auditoría inmutable",
        cuerpo:
          "En 'Auditoría' queda quién hizo qué y cuándo (crear zona, anular, reasignar…). No se edita ni se borra.",
      },
    ],
  },
  {
    id: "adm-aureo",
    rol: "admin",
    icono: "🤖",
    titulo: "Aureo, tu asesor",
    resumen: "Un asistente que responde con TUS datos reales, no inventados.",
    pasos: [
      {
        titulo: "Preguntale en lenguaje natural",
        cuerpo:
          "Desde el botón flotante 🤖 del panel: 'cómo viene la caja este mes', 'ranking de cobradores', 'clientes en riesgo'. Responde anclado en la base, sin inventar cifras.",
        tip: "Aureo respeta los roles: a un supervisor no le da tesorería ni datos de otras zonas; eso es solo del dueño.",
      },
    ],
  },
  {
    id: "adm-reportes",
    rol: "admin",
    icono: "📨",
    titulo: "Reportes y respaldo",
    resumen: "Sacá la data cuando quieras y guardá una copia completa.",
    enlace: { href: "/admin/reportes", texto: "Abrir Reportes" },
    pasos: [
      {
        titulo: "Descargá reportes",
        cuerpo:
          "Cartera, caja, mora, comisiones, clientes y pagos salen en CSV (para Excel). El estado de cuenta de un cliente sale imprimible en PDF.",
      },
      {
        titulo: "Respaldo total",
        cuerpo:
          "Con un clic bajás todo el sistema en varios archivos. Guardalo cada tanto: es tu red de seguridad además de los backups de la base.",
      },
    ],
  },
];

/** Todas las guías (orden de presentación). */
export const GUIAS: GuiaTutorial[] = [...COBRADOR, ...SUPERVISOR, ...ADMIN];

/**
 * Qué roles de guía puede ver cada rol:
 *  · admin      → cobrador + supervisor + admin (todo).
 *  · supervisor → cobrador + supervisor.
 *  · cobrador   → cobrador.
 */
const VE: Record<Rol, Rol[]> = {
  admin: ["cobrador", "supervisor", "admin"],
  supervisor: ["cobrador", "supervisor"],
  cobrador: ["cobrador"],
};

/** Roles de guía visibles para un rol dado (para agrupar en la UI). */
export function rolesVisiblesPara(rol: Rol): Rol[] {
  return VE[rol] ?? ["cobrador"];
}

/** Guías que puede ver un rol, respetando el acceso por rol. */
export function guiasPara(rol: Rol): GuiaTutorial[] {
  const permitidos = new Set(rolesVisiblesPara(rol));
  return GUIAS.filter((g) => permitidos.has(g.rol));
}

/** Etiqueta y color de cada grupo de rol (para los encabezados del tutorial). */
export const ROL_TUTORIAL: Record<Rol, { titulo: string; quien: string; color: string; bg: string }> = {
  cobrador: {
    titulo: "Para el cobrador",
    quien: "Quien está en la calle cobrando",
    color: "#157A50",
    bg: "#E4F5EC",
  },
  supervisor: {
    titulo: "Para el supervisor",
    quien: "Quien controla una o varias zonas",
    color: "#1C6BD6",
    bg: "#E7F1FF",
  },
  admin: {
    titulo: "Para el administrador",
    quien: "El dueño: maneja las reglas y ve todo",
    color: "#1E47C8",
    bg: "#EAF0FF",
  },
};

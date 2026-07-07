// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — CONTENIDO del tutorial in-app, por rol.
//  Núcleo PURO (sin base ni red): las guías y las reglas de quién ve qué.
//  Acceso: admin ve TODO; supervisor ve cobrador + supervisor; cobrador ve
//  solo cobrador. La función guiasPara() es la fuente de verdad de ese acceso.
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
  /** Muestra la leyenda de colores del cartón junto a la guía. */
  leyendaCarton?: boolean;
}

// ── GUÍAS DEL COBRADOR ────────────────────────────────────────────────────
const COBRADOR: GuiaTutorial[] = [
  {
    id: "cob-inicio",
    rol: "cobrador",
    icono: "🧭",
    titulo: "Tu día de un vistazo",
    resumen: "Al entrar ves tu ruta de hoy y cuánto tenés que recaudar.",
    pasos: [
      {
        titulo: "Abrí la app y mirá el arqueo",
        cuerpo:
          "Apenas entrás, arriba aparece lo esperado del día: a cuántos clientes tenés que pasar y cuánto suman sus cuotas. Es tu meta del día.",
      },
      {
        titulo: "Seguí la lista de clientes",
        cuerpo:
          "Debajo está tu ruta ordenada. Cada cliente muestra su nombre y cuánto debería pagar hoy. Los vas marcando a medida que cobrás.",
      },
      {
        titulo: "Instalá la app en el teléfono",
        cuerpo:
          "Desde el navegador, usá 'Agregar a pantalla de inicio'. Queda como una app: abre más rápido y sirve aunque te quedes sin señal un rato.",
        tip: "Solo ves TUS clientes asignados. La cartera completa la ve la oficina, vos no.",
      },
    ],
  },
  {
    id: "cob-pago",
    rol: "cobrador",
    icono: "💵",
    titulo: "Registrar un pago",
    resumen: "Cómo cargar un cobro para que quede con hora, lugar y comprobante.",
    leyendaCarton: true,
    pasos: [
      {
        titulo: "Entrá a la ficha del cliente",
        cuerpo:
          "Tocá el cliente en tu ruta. Vas a ver su cartón: cada casilla es un día. Verde = pagado, ámbar = pendiente/abono, rojo = atrasado, gris = todavía no vence.",
      },
      {
        titulo: "Cargá el monto y registrá",
        cuerpo:
          "Poné lo que te entrega y tocá el botón para registrar el pago. El teléfono guarda la hora del servidor y tu ubicación (GPS): así queda la prueba de que cobraste ahí y en ese momento.",
        tip: "Un abono parcial (menos que la cuota) NO pinta el día de verde: queda en ámbar (pendiente). Recién con la cuota completa el día queda pagado.",
      },
      {
        titulo: "Mostrale el comprobante",
        cuerpo:
          "Cada pago genera un comprobante con la hora y el sello 'Registrado'. El cliente puede verlo desde su propio link. Es tu respaldo y el de él.",
      },
    ],
  },
  {
    id: "cob-nopago",
    rol: "cobrador",
    icono: "🚪",
    titulo: "Cuando no pagan",
    resumen: "Dejá constancia de la visita aunque no hayas cobrado.",
    pasos: [
      {
        titulo: "Registrá la visita",
        cuerpo:
          "Si pasaste y no te pagaron (no estaba, no tenía, pidió para mañana), registrá la visita con el motivo. Queda con GPS y hora igual que un pago.",
        tip: "Registrar el 'no pago' te protege: demuestra que pasaste. La oficina lo ve y no queda como que 'te salteaste' al cliente.",
      },
    ],
  },
  {
    id: "cob-censo",
    rol: "cobrador",
    icono: "📍",
    titulo: "Censar un cliente nuevo",
    resumen: "Relevar en la calle a alguien que todavía no está en el sistema.",
    pasos: [
      {
        titulo: "Usá 'Censar'",
        cuerpo:
          "Cargás sus datos y, muy importante, capturás la ubicación de la casa con el GPS ahí parado en la puerta.",
      },
      {
        titulo: "Por qué importa el GPS",
        cuerpo:
          "La ubicación de la casa es la que después usa el sistema para chequear que los cobros se hagan cerca del domicilio (geo-cerca). Sin ella, no hay control de zona.",
      },
    ],
  },
  {
    id: "cob-cierre",
    rol: "cobrador",
    icono: "🌙",
    titulo: "Cerrar la jornada (rendición)",
    resumen: "Al final del día, rendís lo cobrado. Esto te cuida a vos.",
    pasos: [
      {
        titulo: "Registrá tus gastos de ruta",
        cuerpo:
          "Si tuviste gastos (nafta, boleto), cargalos durante el día. Se descuentan de lo que tenés que entregar.",
      },
      {
        titulo: "Cerrá el día",
        cuerpo:
          "El sistema calcula lo esperado (lo que cobraste menos tus gastos) y vos ponés lo que entregás. Si coincide, perfecto. Si hay diferencia, queda registrada como faltante o sobrante.",
        tip: "La rendición es anti-fuga pero también es tu tranquilidad: deja claro cuánto entregaste y cuándo. Nadie puede decir después que faltó plata sin que figure.",
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
        titulo: "Cobrá igual",
        cuerpo:
          "Si te quedás sin internet, registrá el pago normalmente. Queda guardado en el teléfono, en una cola de pendientes.",
      },
      {
        titulo: "Se sincroniza solo",
        cuerpo:
          "Cuando volvés a tener señal, la app sube los cobros guardados sola. No tenés que hacer nada.",
        tip: "No se duplican: aunque toques dos veces o vuelva la señal a mitad de camino, cada cobro entra UNA sola vez.",
      },
    ],
  },
  {
    id: "cob-chat",
    rol: "cobrador",
    icono: "💬",
    titulo: "Hablar con la oficina",
    resumen: "El chat interno para coordinar sin usar WhatsApp personal.",
    pasos: [
      {
        titulo: "Tus canales",
        cuerpo:
          "Tenés el canal del Equipo (todos), tu hilo privado con la Oficina, y el canal de tu Zona (vos, tu supervisor y los cobradores de tu zona).",
      },
      {
        titulo: "Es privado y queda registrado",
        cuerpo:
          "El hilo con la oficina es solo entre vos y ellos. Los mensajes viajan cifrados. Sirve para avisar 'este cliente se mudó' o 'me falta cambio'.",
      },
    ],
  },
];

// ── GUÍAS DEL SUPERVISOR ──────────────────────────────────────────────────
const SUPERVISOR: GuiaTutorial[] = [
  {
    id: "sup-zona",
    rol: "supervisor",
    icono: "🗺️",
    titulo: "Qué ves como supervisor",
    resumen: "Tu panel está acotado a tu(s) zona(s). No es un permiso de pantalla: lo aplica la base.",
    pasos: [
      {
        titulo: "Solo tu zona",
        cuerpo:
          "El dashboard, clientes, mora, caja, cobranza y control de campo te muestran únicamente los datos de las zonas que tenés asignadas. Los de otras zonas no los podés ver ni buscando.",
        tip: "Si todavía no tenés zonas asignadas, ves todo (modo transición). Apenas el admin te asigna la primera zona, quedás acotado a ella.",
      },
      {
        titulo: "Tu cierre del día",
        cuerpo:
          "En 'Cierre del día' ves en vivo cómo va cada cobrador de tu zona: recaudado, rendiciones, faltantes y alertas. Es tu foto operativa de la jornada.",
      },
    ],
  },
  {
    id: "sup-reasignar",
    rol: "supervisor",
    icono: "🔀",
    titulo: "Reasignar un cliente",
    resumen: "Mover un cliente de un cobrador a otro, dentro de tu zona.",
    pasos: [
      {
        titulo: "Desde la ficha del cliente",
        cuerpo:
          "Abrí el cliente y buscá la sección 'Cobrador asignado'. Elegí a quién se lo pasás en el selector.",
      },
      {
        titulo: "Solo entre tus cobradores",
        cuerpo:
          "Podés mover un cliente entre los cobradores de tu misma zona. Mover clientes de una zona a otra es potestad del admin.",
        tip: "Todo cambio queda auditado: quién movió a quién y cuándo.",
      },
    ],
  },
  {
    id: "sup-anular",
    rol: "supervisor",
    icono: "🚫",
    titulo: "Solicitar anular un pago (doble registro)",
    resumen: "Vos no anulás plata solo: pedís, y otra persona confirma. Es anti-fraude.",
    pasos: [
      {
        titulo: "Pedí la anulación",
        cuerpo:
          "En la ficha del cliente, en el pago que corresponda, tocá 'Solicitar anulación' y escribí el motivo. Queda pendiente.",
      },
      {
        titulo: "La confirma otra persona",
        cuerpo:
          "La solicitud aparece en la bandeja 'Anulaciones'. La confirma el admin u otro supervisor de la zona: nunca vos mismo. Recién ahí el pago se marca anulado.",
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
    pasos: [
      {
        titulo: "Solicitá la renovación",
        cuerpo:
          "En 'Renovaciones' elegís al cliente que terminó bien y proponés el nuevo crédito (monto, cuotas). Queda como solicitud.",
      },
      {
        titulo: "Espera la aprobación",
        cuerpo:
          "El admin revisa y aprueba o rechaza. Si el cliente está marcado como moroso, te va a aparecer el aviso para que lo tengas en cuenta.",
      },
    ],
  },
  {
    id: "sup-chat",
    rol: "supervisor",
    icono: "💬",
    titulo: "Chat de mandos y de zona",
    resumen: "Canales para coordinar sin ruido.",
    pasos: [
      {
        titulo: "Canal Supervisores",
        cuerpo:
          "Un canal reservado para vos, el admin y los demás supervisores. Para coordinar entre mandos sin que lo vean los cobradores.",
      },
      {
        titulo: "Canal de tu Zona",
        cuerpo:
          "Un canal con vos, el admin y los cobradores de tu zona. Ideal para avisos del día. La membresía se ajusta sola: si el admin mueve un cobrador de zona, entra o sale del canal automáticamente.",
      },
    ],
  },
  {
    id: "sup-limites",
    rol: "supervisor",
    icono: "🔒",
    titulo: "Lo que no podés tocar",
    resumen: "Algunas palancas quedan solo para el dueño. Es a propósito.",
    pasos: [
      {
        titulo: "Mora, comisiones y anulación directa",
        cuerpo:
          "Editar la política de mora, fijar/liquidar comisiones y anular pagos directo son del admin. Vos podés verlos (mora, caja) y descargar reportes, pero no cambiarlos.",
        tip: "Esto no es desconfianza: es separar funciones para que ninguna persona sola pueda mover reglas de plata. Te cuida a vos también.",
      },
    ],
  },
];

// ── GUÍAS DEL ADMIN ───────────────────────────────────────────────────────
const ADMIN: GuiaTutorial[] = [
  {
    id: "adm-zonas",
    rol: "admin",
    icono: "🗺️",
    titulo: "Zonas: el cimiento de todo",
    resumen: "Definí territorios y quién ve qué. Sin esto, los supervisores ven todo.",
    pasos: [
      {
        titulo: "Creá las zonas",
        cuerpo:
          "En 'Zonas' creás cada territorio (barrio, ruta). Ponele un nombre y un color para reconocerla en el mapa y los chats.",
      },
      {
        titulo: "Asigná cobradores y supervisores",
        cuerpo:
          "Cada cobrador va en UNA zona. A cada supervisor le marcás qué zonas cubre (puede cubrir varias). Desde ese momento, el supervisor solo ve esas zonas.",
        tip: "Un supervisor SIN zonas asignadas ve toda la operación (transición). Para restringirlo, asignale al menos una zona.",
      },
      {
        titulo: "La zona del cliente se deduce sola",
        cuerpo:
          "No asignás zonas a los clientes: la zona sale del cobrador que los atiende. Si movés un cliente a un cobrador de otra zona, cambia de zona automáticamente.",
      },
    ],
  },
  {
    id: "adm-anulaciones",
    rol: "admin",
    icono: "🚫",
    titulo: "Anular pagos y confirmar solicitudes",
    resumen: "Vos anulás directo; también confirmás las solicitudes de los supervisores.",
    pasos: [
      {
        titulo: "Anular directo",
        cuerpo:
          "En la ficha del cliente, en un pago, tocás 'Anular', escribís el motivo y listo. El pago queda anulado (no se borra) con tu firma.",
      },
      {
        titulo: "Confirmar lo que piden los supervisores",
        cuerpo:
          "En la bandeja 'Anulaciones' ves lo pendiente. Confirmás o rechazás. No podés confirmar una solicitud que pediste vos: siempre son dos personas distintas (doble registro).",
        tip: "Quedó blindado: un supervisor solo puede pedir/confirmar anulaciones de su propia zona. Nadie toca plata de otra zona.",
      },
    ],
  },
  {
    id: "adm-scoring",
    rol: "admin",
    icono: "🧮",
    titulo: "Scoring crediticio configurable",
    resumen: "Vos definís cómo se puntúa a los clientes.",
    pasos: [
      {
        titulo: "Ajustá los pesos",
        cuerpo:
          "En 'Scoring' movés cuánto pesa cada factor (cumplimiento, mora actual, experiencia, consistencia, antigüedad) y los umbrales de cada banda.",
      },
      {
        titulo: "Se recalcula solo",
        cuerpo:
          "El score no se guarda: se calcula sobre el historial real. Al cambiar el modelo, todos se re-puntúan al instante. Podés ver la evolución del score de cada cliente en su ficha.",
      },
    ],
  },
  {
    id: "adm-mora-comisiones",
    rol: "admin",
    icono: "⚙️",
    titulo: "Mora y comisiones",
    resumen: "Las reglas de plata que solo vos manejás.",
    pasos: [
      {
        titulo: "Política de mora",
        cuerpo:
          "Configurás el recargo por atraso. Se aplica de forma pareja y trazable, no a ojo.",
      },
      {
        titulo: "Comisiones de cobradores",
        cuerpo:
          "Fijás el porcentaje por cobrador y liquidás; la liquidación impacta en caja. El supervisor lo ve pero no lo cambia.",
      },
    ],
  },
  {
    id: "adm-reportes",
    rol: "admin",
    icono: "📨",
    titulo: "Reportes y respaldo",
    resumen: "Sacá la data cuando quieras y guardá una copia completa.",
    pasos: [
      {
        titulo: "Descargá reportes",
        cuerpo:
          "Cartera, caja, mora, comisiones, clientes y pagos salen en CSV (listo para Excel). El estado de cuenta de un cliente sale imprimible en PDF.",
      },
      {
        titulo: "Respaldo total",
        cuerpo:
          "Con un clic bajás todo el sistema en varios archivos. Guardalo cada tanto: es tu red de seguridad además de los backups de la base.",
      },
    ],
  },
  {
    id: "adm-control",
    rol: "admin",
    icono: "🛰️",
    titulo: "Control de campo y auditoría",
    resumen: "Cada acción con GPS, hora y un log que no se puede editar.",
    pasos: [
      {
        titulo: "Bitácora y score de sospecha",
        cuerpo:
          "En 'Control de campo' ves los movimientos de cada cobrador con GPS y hora del servidor. Un score de sospecha marca patrones raros (planchar, cobrar fuera de zona, sin moverse).",
      },
      {
        titulo: "Auditoría inmutable",
        cuerpo:
          "En 'Auditoría' queda quién hizo qué y cuándo (crear zona, anular, reasignar…). Es un registro que no se edita ni se borra.",
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
          "Desde el botón flotante del panel: 'cómo viene la caja este mes', 'ranking de cobradores', 'clientes en riesgo'. Responde anclado en la base, sin inventar cifras.",
        tip: "Aureo respeta los roles: a un supervisor no le da información de tesorería que es solo del dueño.",
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

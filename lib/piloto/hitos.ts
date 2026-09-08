// ─────────────────────────────────────────────────────────────────────────
//  BITÁCORA DEL PILOTO — los hitos que explican por qué la base está como está.
//  Curada a mano al cierre de cada sesión de trabajo (no se deriva de la base:
//  un deploy o un empalme no dejan una fila que diga qué significaron).
//  Más nuevo primero. `tono` marca lo que fue incidente vs. avance.
// ─────────────────────────────────────────────────────────────────────────

export type TonoHito = "avance" | "incidente" | "regla" | "deploy";

export interface Hito {
  fecha: string; // YYYY-MM-DD
  titulo: string;
  detalle: string;
  tono: TonoHito;
  commit?: string;
}

export const HITOS: Hito[] = [
  {
    fecha: "2026-09-07",
    titulo: "Espejo de activos con Disapp: 860 cierres, fichas dobles al peso, dobles ambiguos resueltos",
    detalle:
      "\"Los 27 créditos\" eran 870: el paso 6 del empalme saltea todo crédito de un cobrador vivo. Nueva regla del corte para unificar fichas dobles (Σ importados ≤ último pago nativo == Σ nativos, al peso). Se descubrió que una ref con dos créditos en la app recibe la historia dos veces (--excluir-ref).",
    tono: "avance",
    commit: "70847c6",
  },
  {
    fecha: "2026-09-06",
    titulo: "Regla del +20% SIN tope: se coloca y se avisa (supervisor + admin)",
    detalle:
      "Carlos reafirmó que la renovación por más valor no pide permiso, solo notifica. Aviso en cuatro lugares porque el push tiene 0 suscriptos. La revisión adversarial cazó el pie de /cobrador/colocar que decía \"no entregues la plata\" debajo de \"Entregale la plata\".",
    tono: "regla",
    commit: "fdfefa7",
  },
  {
    fecha: "2026-09-06",
    titulo: "Empalme de agosto + 1..6 de septiembre, en cuatro corridas",
    detalle:
      "La 1ª murió con NameError después de escribir 1.165 créditos sin ruta; la 2ª por timeout (base saturada por agentes en paralelo); la 3ª completa (+18.560 recaudos); la 4ª solo los adoptados. Dos incidentes propios: la guardia de dobles mató la adopción, y censo+oficina dio 8 créditos dobles.",
    tono: "incidente",
  },
  {
    fecha: "2026-09-06",
    titulo: "El deploy es manual: un push no publica nada",
    detalle: "Prod estuvo sirviendo el build viejo hasta correr `npx vercel --prod`. El package-lock volvió a perder @emnapi/runtime (CI rojo silencioso). Verificado con sesión real (_probe-deploy-0906.mjs).",
    tono: "deploy",
  },
  {
    fecha: "2026-09-05",
    titulo: "Lo que se le dice al cobrador cuando el cobro no entra: que sea verdad",
    detalle:
      "De 11.466 finalizados, 11.148 no tienen linaje: \"se renovó\" y \"se saldó\" son indistinguibles y el consejo es opuesto. De 1.323 \"ya no está en tu ruta\", 1.013 no los tiene ningún cobrador. Guardia anti-duplicados en los cuatro importadores.",
    tono: "avance",
    commit: "5f467d8",
  },
  {
    fecha: "2026-09-04",
    titulo: "Comisión congelada al cobrar + reasignar atómico + visibilidad de operación",
    detalle:
      "La comisión salía del dueño de HOY: reasignar reescribía $6,8M hacia atrás. Backfill de 4.621 pagos con la verificación dentro de la transacción. /admin/operacion: quién no cobra, carga, sin ruta, cartera de baja.",
    tono: "avance",
    commit: "1ea750f",
  },
  {
    fecha: "2026-09-04",
    titulo: "\"La caja no queda de un día para otro\" no era bug: era acceso",
    detalle: "El arrastre existe y está probado, pero se alimenta del ACTA: 4 cierres en todo el piloto, 145 días-cobrador sin acta. Barra fija de cierre, aviso al tope, tarjeta en el panel.",
    tono: "regla",
  },
  {
    fecha: "2026-09-04",
    titulo: "Formato del crédito (diario/semanal) elegible en las seis puertas; lib/domain/credito.ts única fuente",
    detalle: "783 activos no diarios = 62,7% del capital: el rótulo \"días\" mentía sobre la mayoría del dinero. El guardián que lee el código fuente impide que una puerta vuelva a hacer su propia cuenta.",
    tono: "avance",
    commit: "d2ab7fc",
  },
  {
    fecha: "2026-08-21",
    titulo: "Quejas repetidas cerradas: franja en vivo de pedidos sin opt-in, la vuelta al cobrador por push",
    detalle: "+20% = último crédito registrado. Pantalla única \"Pedidos y renovaciones\". Nombres a 3 líneas verificados en prod.",
    tono: "avance",
    commit: "c26a5e1",
  },
  {
    fecha: "2026-08-17",
    titulo: "Empalme incremental: +7.105 recaudos, +607 créditos",
    detalle: "La app manda en los choques. Duplicó pagos por día ($997.474 aparentes; medidos después: 41 pares / $38.350) → guardia por CUOTA.",
    tono: "incidente",
    commit: "089d9d7",
  },
  {
    fecha: "2026-08-16",
    titulo: "Tienda fase 1 + acta pre-lunes + deploy verificado (día-en-la-vida 22/22)",
    detalle: "Respaldo cada 15 min 07–22h. Regla: nunca deploy en horario de calle (invalida los action IDs del panel abierto).",
    tono: "deploy",
    commit: "6154495",
  },
  {
    fecha: "2026-08-15",
    titulo: "QA fases 2–5: harness PG, sesión de caos, tablero-qa con baselines",
    detalle: "Cazó que 0142 mató el reparador (→0145), 0147 gemelos atómicos, kill-switch en premios. Baseline: 292 sobre-cobro heredado, 217 nativos saldados sin finalizar.",
    tono: "avance",
    commit: "eac4bae",
  },
  {
    fecha: "2026-08-13",
    titulo: "Primer crédito directo desde la calle; solo pide autorización lo que supera el +20% (CAP $100k)",
    detalle: "App del cobrador reorganizada: Hoy · Clientes · Informes · Menú. Piso de interés 1%: 82 activos al 0–1% eran import roto.",
    tono: "regla",
    commit: "59a6f6b",
  },
  {
    fecha: "2026-08-07",
    titulo: "Reglas para colocar capital (ley de Carlos)",
    detalle: "Renovar = repetir tal cual, un toque. Nueva venta = eligiendo monto/cuotas. Un cliente puede tener dos créditos sin estar al día (el sistema dejaba fuera al 86%).",
    tono: "regla",
  },
  {
    fecha: "2026-08-05",
    titulo: "DÍA 1 en campo: los 9 fallos",
    detalle: "P0410 falso (SECURITY INVOKER + RLS), la ruta traía créditos del compañero (doble cobro), React 19 resetea <form action> (censo muerto), el empalme cerró 370 créditos con deuda viva → candado del paso 6.",
    tono: "incidente",
  },
  {
    fecha: "2026-08-04",
    titulo: "Empalme TOTAL con Disapp: espejo 2.828/2.828, drift 0",
    detalle: "92 créditos muertos reconstruidos ($1,1M). CAP con --corte. Regla del origen: custodia/comisiones/vigilancia = solo nativos.",
    tono: "avance",
    commit: "47f09a3",
  },
  {
    fecha: "2026-08-03",
    titulo: "Pre-lanzamiento: libro inmutable (0126), custodia, respaldos verificados",
    detalle: "Un pago no se borra ni se edita: se anula con motivo. Un crédito solo avanza de estado. Runbook 3-2-1 de respaldos. Piloto = Zona Centro.",
    tono: "regla",
    commit: "a01e49d",
  },
  {
    fecha: "2026-07-21",
    titulo: "Verificación de arranque: logins uno a uno, RLS por zona empírica",
    detalle: "Carlos autoriza trabajo autónomo: nunca float para dinero; nada irreversible sin avisar; migraciones delegadas vía pg8000.",
    tono: "regla",
  },
];

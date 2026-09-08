// ─────────────────────────────────────────────────────────────────────────
//  ESPEJO CON DISAPP — resultado de cada empalme, tal como lo midió
//  `scripts/verificar-post-empalme.py` (crédito por crédito: pagado_acum de la
//  app vs 'Pagos' del export de Disapp). Curado a mano después de cada corrida:
//  el export es un archivo que se carga desde la PC de Carlos, no vive en la
//  base, así que el panel no lo puede calcular solo.
// ─────────────────────────────────────────────────────────────────────────

export interface EmpalmeRegistro {
  fecha: string; // YYYY-MM-DD del export
  /** Créditos activos en la app / en el export de Disapp (todas las zonas). */
  activosApp: number;
  activosDisapp: number;
  exactos: number;
  cortos: number;
  pasados: number;
  /** Plata: lo que a la app le falta (cortos) y lo que le sobra (pasados). */
  montoCortos: number | null;
  montoPasados: number | null;
  /** Créditos de Disapp que la app no tiene. */
  noEstanEnApp: number;
  recaudosCargados: number | null;
  notas: string;
}

export const EMPALMES: EmpalmeRegistro[] = [
  {
    fecha: "2026-08-04",
    activosApp: 2817,
    activosDisapp: 2817,
    exactos: 2828,
    cortos: 0,
    pasados: 0,
    montoCortos: 0,
    montoPasados: 0,
    noEstanEnApp: 0,
    recaudosCargados: null,
    notas: "Empalme TOTAL: espejo 2.828/2.828, drift 0, 92 créditos muertos reconstruidos ($1,1M). 678 fantasmas barridos en el re-empalme del 05-08.",
  },
  {
    fecha: "2026-08-17",
    activosApp: 3111,
    activosDisapp: 2402,
    exactos: 0,
    cortos: 0,
    pasados: 0,
    montoCortos: null,
    montoPasados: null,
    noEstanEnApp: 0,
    recaudosCargados: 7105,
    notas: "Incremental: +7.105 recaudos (la app manda en los choques), +607 créditos, 475 top-ups anulados. Disapp mostraba 2.402 porque el tablero esconde los vencidos. ⚠️ Duplicó pagos por día (guardia por CUOTA después).",
  },
  {
    fecha: "2026-09-06",
    activosApp: 3726,
    activosDisapp: 2881,
    exactos: 2598,
    cortos: 15,
    pasados: 215,
    montoCortos: 6343,
    montoPasados: 3239631,
    noEstanEnApp: 53,
    recaudosCargados: 18560,
    notas: "Agosto entero + 1..6 de septiembre en cuatro corridas (NameError en la 1ª, timeout en la 2ª). 121 dobles exactos adoptados; 5 fichas dobles unificadas. 53 no en la app = 42 del vendedor 14610 + 11 dobles ambiguos.",
  },
  {
    fecha: "2026-09-07",
    activosApp: 2863,
    activosDisapp: 2881,
    exactos: 2609,
    cortos: 15,
    pasados: 215,
    montoCortos: 6343,
    montoPasados: 3239631,
    noEstanEnApp: 42,
    recaudosCargados: 57,
    notas: "Espejo de activos: 860 créditos que Disapp ya no lista cerrados (320 saldados, 477 sobre-pagados, 63 con deuda); 6 fichas dobles unificadas al peso; los 11 dobles ambiguos resueltos (6 adoptados, 5 creados, 2 cancelados). Los 42 que faltan son todos del vendedor 14610.",
  },
];

export const ultimoEmpalme = (): EmpalmeRegistro => EMPALMES[EMPALMES.length - 1];

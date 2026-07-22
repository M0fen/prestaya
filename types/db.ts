// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — tipos que reflejan el esquema de la base de datos (Supabase).
//
//  Se nombran en snake_case para mapear 1:1 con las columnas SQL de
//  `supabase/migrations/0001_inicial.sql` (más fácil de cotejar contra el
//  esquema). El dinero llega de PostgREST como string; la capa de datos
//  (lib/data) lo convierte a number antes de devolver estos objetos.
// ─────────────────────────────────────────────────────────────────────────

export type Rol = "admin" | "supervisor" | "cobrador";

export interface Usuario {
  id: string;
  nombre: string;
  telefono: string | null;
  rol: Rol;
  activo: boolean;
  auth_user_id: string | null;
  /** Zona del cobrador (una sola). null en admin/supervisor y cobradores sin zona. */
  zona_id: string | null;
  /** Desarrollador: es un admin (poder total) + herramientas extra (ver 0034). */
  es_dev: boolean;
  /** Comisión (%) del cobrador sobre lo recaudado. null/0 = sin comisión. Viene
   *  en la fila propia (select *); opcional para no romper otros constructores. */
  comision_pct?: number | null;
  creado_en: string;
  actualizado_en: string;
}

// ── Zonas (Fase A — territorio de cobro, ver 0030) ────────────────────────

/** Barrio / sector / ruta madre. El cobrador pertenece a una; el supervisor
 *  cubre varias; el cliente/préstamo DERIVA su zona del cobrador asignado. */
export interface Zona {
  id: string;
  nombre: string;
  color: string | null;
  descripcion: string | null;
  activo: boolean;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
}

/** Vínculo supervisor ↔ zona (un supervisor cubre varias). */
export interface SupervisorZona {
  supervisor_id: string;
  zona_id: string;
  asignado_por: string | null;
  asignado_en: string;
}

export type Calificacion =
  | "nuevo"
  | "excelente"
  | "bueno"
  | "regular"
  | "riesgo";

export interface Cliente {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  /** Token del link de acceso de solo lectura para el cliente. */
  token_acceso: string;
  calificacion: Calificacion;
  notas: string | null;
  activo: boolean;
  /** "oficina" (alta de gestor) u "censo" (relevado en calle por el cobrador). */
  origen: "oficina" | "censo";
  /** Usuario que dio de alta al cliente (cobrador o gestor). */
  creado_por: string | null;
  /** Ubicación capturada al censar (casa del cliente). */
  gps_lat: number | null;
  gps_lng: number | null;
  // ── Paridad Disapp (0041) ──────────────────────────────────────────────
  /** Reportado a buró / lista de morosos (atributo del cliente; NO es la tabla
   *  `reportes`, que son quejas del cliente vía token). */
  reportado: boolean;
  genero: "masculino" | "femenino" | "otro" | null;
  ciudad: string | null;
  direccion_secundaria: string | null;
  /** Ruta de la foto en Storage (bucket privado, 0044). null = sin foto. */
  foto_path: string | null;
  /** Número de registro correlativo (0081). Sus últimos 3 dígitos son el número
   *  de la suerte de la quiniela. null si la migración aún no corrió. */
  numero_registro: number | null;
  // ── Alta en la app (0084) ──────────────────────────────────────────────
  /** Cuándo el cobrador le compartió su link/QR. Lo declara el cobrador. */
  acceso_entregado_en: string | null;
  /** Quién se lo entregó (usuarios.id). */
  acceso_entregado_por: string | null;
  /** Primera vez que el CLIENTE abrió su cartón: la prueba real del alta. */
  acceso_visto_en: string | null;
  creado_en: string;
  actualizado_en: string;
}

export type EstadoPrestamo =
  | "activo"
  | "finalizado"
  | "cancelado"
  | "incobrable"
  // Rollover a 0% (refinanciación): el saldo lo carga el crédito más nuevo del
  // cliente. NO es deuda activa → excluido de cartera/mora/ruta (0054). Los pagos
  // quedan; el crédito se ve en el historial. Ver memory/refinanciacion-cuadre.md.
  | "refinanciado";

/** Frecuencia de las cuotas. "diario" es el caso histórico (cobro diario). */
export type FrecuenciaPrestamo = "diario" | "semanal" | "quincenal" | "mensual";

export interface Prestamo {
  id: string;
  cliente_id: string;
  cobrador_id: string | null;
  /** Capital entregado (UYU). number ya parseado desde numeric. */
  monto_prestado: number;
  /** Cuota fija por período (UYU). number ya parseado desde numeric. */
  cuota_diaria: number;
  /** Cantidad de cuotas del crédito (histórico: "días"). */
  total_dias: number;
  /** Frecuencia de las cuotas (diario/semanal/quincenal/mensual). */
  frecuencia: FrecuenciaPrestamo;
  /** Fecha de inicio "YYYY-MM-DD". */
  fecha_inicio: string;
  estado: EstadoPrestamo;
  creado_por: string | null;
  // ── Paridad Disapp (0041) ──────────────────────────────────────────────
  /** Marca los créditos VIP al 0% de la cartera de supervisor (CESAR/BOSO/EDWIN).
   *  El saldo/mora sigue saliendo del cartón; esto es solo clasificación. */
  es_float_supervisor: boolean;
  /** % de interés informativo del import (Disapp). La app NO lo usa para el saldo
   *  (el saldo sale del cartón); sirve para mostrar el % exacto en informes. */
  interes_pct: number | null;
  creado_en: string;
  actualizado_en: string;
  finalizado_en: string | null;
}

export interface Pago {
  id: string;
  prestamo_id: string;
  /** Día del crédito al que se imputa (1..total_dias). */
  dia_credito: number;
  /** Monto del pago (UYU). number ya parseado desde numeric. */
  monto: number;
  registrado_por: string | null;
  registrado_en: string;
  gps_lat: number | null;
  gps_lng: number | null;
  // Reversión sin borrar (la verdad del dinero es inmutable).
  anulado: boolean;
  anulado_por: string | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
}

export type ResultadoVisita =
  | "pago"
  | "abono"
  | "no_pago"
  | "no_estaba"
  | "otro";

export interface Visita {
  id: string;
  prestamo_id: string;
  cobrador_id: string | null;
  resultado: ResultadoVisita;
  motivo: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  registrado_en: string;
}

export interface Asignacion {
  id: string;
  cobrador_id: string;
  cliente_id: string;
  activo: boolean;
  asignado_en: string;
}

// ── Caja / tesorería (movimientos de efectivo que NO son cobros, ver 0010) ──

/** ingreso (+) aporte de capital · egreso (−) gasto operativo ·
 *  desembolso (−) plata al colocar un crédito · retiro (−) retiro del dueño. */
export type TipoMovimientoCaja = "ingreso" | "egreso" | "desembolso" | "retiro";

/** operativa = gastos de ruta ("Caja Diaria") · capital = aportes/retiros/
 *  transferencias/descuadres ("Inversión de Capital"). Ver 0041. */
export type CuentaCaja = "operativa" | "capital";

export interface MovimientoCaja {
  id: string;
  tipo: TipoMovimientoCaja;
  categoria: string | null;
  monto: number;
  descripcion: string | null;
  cobrador_id: string | null;
  registrado_por: string | null;
  fecha: string;
  registrado_en: string;
  // ── Paridad Disapp (0041) ──────────────────────────────────────────────
  cuenta: CuentaCaja;
  /** Si el movimiento aparece en la app del cobrador ("Visible Sí/No" de Disapp). */
  visible: boolean;
}

/** Tema visual del banner de anuncio. "dorado" = negro + oro (publicidad premium). */
export type TemaAnuncio = "azul" | "verde" | "ambar" | "oscuro" | "dorado";

/** A qué clientes se les muestra el anuncio, según el estado de su crédito. */
export type SegmentoAnuncio = "todos" | "al_dia" | "con_pendientes";

export interface Anuncio {
  id: string;
  titulo: string;
  cuerpo: string | null;
  cta_texto: string | null;
  cta_url: string | null;
  imagen_url: string | null;
  /** Rótulo del "eyebrow" (por defecto "Novedad"). Para publicidad: "Publicidad". */
  etiqueta: string | null;
  tema: TemaAnuncio;
  prioridad: number;
  activo: boolean;
  segmento: SegmentoAnuncio;
  fecha_inicio: string;
  fecha_fin: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
}

export type EstadoReporte = "nuevo" | "en_revision" | "resuelto" | "descartado";

export interface Reporte {
  id: string;
  cliente_id: string;
  prestamo_id: string | null;
  tipo: "falta_pago" | "otro";
  dia_credito: number | null;
  monto_reclamado: number | null;
  comentario: string | null;
  estado: EstadoReporte;
  creado_en: string;
  atendido_por: string | null;
  atendido_en: string | null;
}

// ── Chat interno y notas (comunicación de la operación, ver 0007) ─────────

/**
 * Ámbito de un mensaje / tipo de canal:
 *  · 'general'      → hilo único del equipo (todos los internos).
 *  · 'cobrador'     → hilo privado gestor ↔ un cobrador (cobrador_id).
 *  · 'supervisores' → canal de mandos (admin + supervisores).
 *  · 'zona'         → canal de una zona (admin + su supervisor + sus cobradores).
 */
export type AmbitoMensaje = "general" | "cobrador" | "supervisores" | "zona";

export interface Mensaje {
  id: string;
  ambito: AmbitoMensaje;
  /** Cobrador dueño del hilo (solo ambito 'cobrador'). */
  cobrador_id: string | null;
  /** Zona del canal (solo ambito 'zona'). */
  zona_id: string | null;
  autor_id: string;
  cuerpo: string;
  creado_en: string;
}

export interface NotaCliente {
  id: string;
  cliente_id: string;
  autor_id: string;
  cuerpo: string;
  creado_en: string;
}

export interface NotaPersonal {
  id: string;
  usuario_id: string;
  cuerpo: string;
  creado_en: string;
  actualizado_en: string;
}

// ── Tipos de entrada para escrituras (sin columnas autogeneradas) ─────────

/** Datos necesarios para registrar un pago nuevo. */
export interface NuevoPago {
  prestamo_id: string;
  dia_credito: number;
  monto: number;
  registrado_por?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  /** Hora real del cobro (ISO). Para cobros offline sincronizados después. */
  registrado_en?: string | null;
  /** Id de la operación offline (dedupe exactly-once, índice único, ver 0006). */
  op_id?: string | null;
}

/** Datos para crear un reporte de discrepancia del cliente. */
export interface NuevoReporte {
  cliente_id: string;
  prestamo_id?: string | null;
  tipo?: "falta_pago" | "otro";
  dia_credito?: number | null;
  monto_reclamado?: number | null;
  comentario?: string | null;
}

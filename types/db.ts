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
  creado_en: string;
  actualizado_en: string;
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
  creado_en: string;
  actualizado_en: string;
}

export type EstadoPrestamo =
  | "activo"
  | "finalizado"
  | "cancelado"
  | "incobrable";

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

/** Tema visual del banner de anuncio. */
export type TemaAnuncio = "azul" | "verde" | "ambar" | "oscuro";

/** A qué clientes se les muestra el anuncio, según el estado de su crédito. */
export type SegmentoAnuncio = "todos" | "al_dia" | "con_pendientes";

export interface Anuncio {
  id: string;
  titulo: string;
  cuerpo: string | null;
  cta_texto: string | null;
  cta_url: string | null;
  imagen_url: string | null;
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

/** Ámbito de un mensaje: hilo general del equipo o hilo de un cobrador. */
export type AmbitoMensaje = "general" | "cobrador";

export interface Mensaje {
  id: string;
  ambito: AmbitoMensaje;
  /** Cobrador dueño del hilo (null en el general). */
  cobrador_id: string | null;
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

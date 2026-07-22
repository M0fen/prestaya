// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — datos de DEMO con la forma REAL de la base de datos.
//  Sirven para renderizar la vista de cliente sin tocar Supabase. Se
//  reemplazan por la capa de datos (lib/data/) cuando haya datos reales.
//
//  Reproducen los mismos estados que el diseño original (días 1–10 pagados,
//  día 11 atrasado, día 12 abono parcial HOY, 13–30 futuros) usando como
//  "hoy" la fecha fija `HOY_DEMO` para que el ejemplo sea estable.
// ─────────────────────────────────────────────────────────────────────────
import type { Cliente, Pago, Prestamo } from "@/types/db";
import { parseFecha } from "@/lib/format";

// IDs ficticios solo para el demo.
const CLIENTE_ID = "00000000-0000-0000-0000-000000000001";
const PRESTAMO_ID = "00000000-0000-0000-0000-0000000000a1";

/** "Hoy" de referencia para el demo (en prod: new Date() del servidor).
 *  Con cobro Lun–Sáb, la 12ª cuota diaria (inicio miércoles 03-jun) cae el
 *  martes 16-jun (se saltean los domingos 07 y 14). */
export const HOY_DEMO = parseFecha("2026-06-16");

export const clienteMock: Cliente = {
  id: CLIENTE_ID,
  nombre: "María Fernanda Píriz",
  documento: "4.812.357-6",
  telefono: "099 612 845",
  direccion: "Av. 8 de Octubre 2547, Montevideo",
  token_acceso: "demo-token",
  calificacion: "bueno",
  notas: null,
  activo: true,
  origen: "oficina",
  creado_por: null,
  gps_lat: null,
  gps_lng: null,
  reportado: false,
  genero: "femenino",
  ciudad: "Montevideo",
  direccion_secundaria: null,
  foto_path: null,
  numero_registro: 1042, // demo: número de la suerte 042
  acceso_entregado_en: null,
  acceso_entregado_por: null,
  acceso_visto_en: null,
  creado_en: "2026-06-03T00:00:00Z",
  actualizado_en: "2026-06-03T00:00:00Z",
};

export const prestamoMock: Prestamo = {
  id: PRESTAMO_ID,
  cliente_id: CLIENTE_ID,
  cobrador_id: null,
  monto_prestado: 25000, // capital entregado (UYU)
  cuota_diaria: 1000, // cuota fija diaria (UYU)
  total_dias: 30, // total a pagar 30.000 (interés 5.000)
  frecuencia: "diario",
  fecha_inicio: "2026-06-03",
  estado: "activo",
  creado_por: null,
  es_float_supervisor: false,
  interes_pct: null,
  creado_en: "2026-06-03T00:00:00Z",
  actualizado_en: "2026-06-03T00:00:00Z",
  finalizado_en: null,
};

/** Helper para construir un pago de demo sin repetir campos. */
function pagoDemo(dia: number, fecha: string, monto: number, hora = "09"): Pago {
  return {
    id: `${PRESTAMO_ID}-${dia}`,
    prestamo_id: PRESTAMO_ID,
    dia_credito: dia,
    monto,
    registrado_por: null,
    registrado_en: `${fecha}T${hora}:30:00Z`,
    gps_lat: null,
    gps_lng: null,
    anulado: false,
    anulado_por: null,
    anulado_en: null,
    motivo_anulacion: null,
  };
}

export const pagosMock: Pago[] = [
  pagoDemo(1, "2026-06-03", 1000, "08"),
  pagoDemo(2, "2026-06-04", 1000, "10"),
  pagoDemo(3, "2026-06-05", 1000, "09"),
  pagoDemo(4, "2026-06-06", 1000, "11"),
  pagoDemo(5, "2026-06-07", 1000, "08"),
  pagoDemo(6, "2026-06-08", 1000, "12"),
  pagoDemo(7, "2026-06-09", 1000, "09"),
  pagoDemo(8, "2026-06-10", 1000, "10"),
  pagoDemo(9, "2026-06-11", 1000, "08"),
  pagoDemo(10, "2026-06-12", 1000, "11"),
  // dia 11 (2026-06-13): sin pago  → ATRASADO
  pagoDemo(12, "2026-06-14", 500, "09"), // abono parcial HOY → PENDIENTE
  // dias 13–30: aún no vencen → FUTURO
];

// ─────────────────────────────────────────────────────────────────────────
//  Presta Ya — modelo de datos del préstamo
//  Estructura pensada para mapear 1:1 a una base de datos real.
//  El componente visual NO contiene datos: solo consume este objeto.
//
//  En producción, `fechaHoy` vendría del servidor (new Date()) y `pagos`
//  de la tabla de transacciones del cliente. Aquí se fija una fecha de
//  referencia para que el ejemplo muestre todos los estados de forma estable.
// ─────────────────────────────────────────────────────────────────────────

export const loan = {
  cliente: {
    nombre: "María Fernanda",
    inicial: "M",
  },

  negocio: {
    nombre: "Presta Ya",
    direccion: "Cra. 12 # 45 - 30, Bogotá",
    telefono: "(601) 742 0098",
    horario: "Lunes a sábado, 8:00 a. m. – 6:00 p. m.",
  },

  credito: {
    montoPrestado: 500000,   // capital entregado al cliente
    cuotaDiaria:    20000,   // valor fijo a pagar cada día
    totalDias:         30,   // duración del crédito en días
    fechaInicio: "2026-06-03",
    fechaHoy:    "2026-06-14", // referencia "hoy" (en prod: fecha del servidor)
  },

  // Pagos registrados, tal como llegarían de la base de datos.
  // Cada registro: { dia, fecha, monto }. Un día sin registro = no pagó.
  pagos: [
    { dia: 1,  fecha: "2026-06-03", monto: 20000 },
    { dia: 2,  fecha: "2026-06-04", monto: 20000 },
    { dia: 3,  fecha: "2026-06-05", monto: 20000 },
    { dia: 4,  fecha: "2026-06-06", monto: 20000 },
    { dia: 5,  fecha: "2026-06-07", monto: 20000 },
    { dia: 6,  fecha: "2026-06-08", monto: 20000 },
    { dia: 7,  fecha: "2026-06-09", monto: 20000 },
    { dia: 8,  fecha: "2026-06-10", monto: 20000 },
    { dia: 9,  fecha: "2026-06-11", monto: 20000 },
    { dia: 10, fecha: "2026-06-12", monto: 20000 },
    // dia 11 (2026-06-13): sin pago  → ATRASADO
    { dia: 12, fecha: "2026-06-14", monto: 10000 }, // abono parcial HOY → PENDIENTE
    // dias 13–30: aún no vencen → FUTURO
  ],
};

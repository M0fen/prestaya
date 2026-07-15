// Reglas COMPARTIDAS de gastos de ruta (las usan la app del cobrador y el server).
// Qué comprobante corresponde según la ACTIVIDAD: combustible/peaje/otro exigen
// foto de la factura/ticket (control anti-fraude del egreso); la comida es opcional.

export const CATEGORIAS_GASTO = ["Combustible", "Comida", "Peaje", "Otro"] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

const OBLIGA_COMPROBANTE = new Set<string>(["Combustible", "Peaje", "Otro"]);

/** ¿Esta actividad EXIGE adjuntar el comprobante para poder solicitar el gasto? */
export function pideComprobante(categoria: string | null | undefined): boolean {
  return OBLIGA_COMPROBANTE.has(categoria ?? "");
}

/** Qué se le pide adjuntar al cobrador, según la actividad (texto de ayuda). */
export function hintComprobante(categoria: string | null | undefined): string {
  if (categoria === "Combustible") return "Adjuntá la factura de la carga";
  if (categoria === "Peaje") return "Adjuntá el ticket del peaje";
  if (categoria === "Comida") return "Foto del comprobante (opcional)";
  return "Adjuntá una foto del comprobante";
}

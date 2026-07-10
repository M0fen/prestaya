// ─────────────────────────────────────────────────────────────────────────
//  Número a letras en español (rioplatense). Para comprobantes/recibos: un
//  recibo serio dice el monto en palabras además de en cifras (anti-adulteración).
//  Pura y testeable. Soporta 0 … 999.999.999 + centavos ("con NN/100").
// ─────────────────────────────────────────────────────────────────────────

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0..999 en palabras. `apocope` = usar "un"/"veintiún" (antes de mil/millón/sustantivo). */
function centenasALetras(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  let out = "";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) out += CENTENAS[c];
  if (resto > 0) {
    if (out) out += " ";
    if (resto < 30) {
      let u = UNIDADES[resto];
      if (apocope && resto === 1) u = "un";
      else if (apocope && resto === 21) u = "veintiún";
      out += u;
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d];
      if (u > 0) out += " y " + (apocope && u === 1 ? "un" : UNIDADES[u]);
    }
  }
  return out;
}

/** Entero no negativo a palabras (0 … 999.999.999). */
export function enteroALetras(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones > 0) {
    partes.push(millones === 1 ? "un millón" : `${centenasALetras(millones, true)} millones`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? "mil" : `${centenasALetras(miles, true)} mil`);
  }
  if (resto > 0) {
    partes.push(centenasALetras(resto, false));
  }
  return partes.join(" ").trim();
}

/**
 * Monto en pesos uruguayos, en letras, estilo comprobante:
 *   1 → "Un peso uruguayo"
 *   2.500 → "Dos mil quinientos pesos uruguayos"
 *   1.234,50 → "Mil doscientos treinta y cuatro pesos uruguayos con 50/100"
 * La primera letra va en mayúscula.
 */
export function montoALetras(monto: number): string {
  const entero = Math.floor(Math.abs(monto));
  const centavos = Math.round((Math.abs(monto) - entero) * 100);
  let palabras = enteroALetras(entero);
  // Apócope ante el sustantivo "pesos": uno→un, veintiuno→veintiún,
  // "treinta y uno"→"treinta y un", "ciento uno"→"ciento un", etc.
  palabras = palabras.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
  const moneda = entero === 1 ? "peso uruguayo" : "pesos uruguayos";
  let texto = `${palabras} ${moneda}`;
  if (centavos > 0) texto += ` con ${String(centavos).padStart(2, "0")}/100`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers para exportar reportes a CSV (abre directo en Excel).
//  - Separador ";"  → Excel en configuración regional es-UY usa ";" como
//    separador de lista; así las columnas quedan bien sin "Importar datos".
//  - BOM UTF-8       → Excel respeta los acentos (José, Ñ, etc.).
//  - Los MONTOS se exportan como enteros crudos (sin "$" ni separador de
//    miles) para que el contador pueda sumar/pivotar en la planilla.
//  Puro y testeable: no toca red ni Response.
// ─────────────────────────────────────────────────────────────────────────

export type CeldaCsv = string | number | null | undefined;

/** Escapa una celda: envuelve en comillas si tiene ";", comillas o salto, y
 *  neutraliza inyección de fórmulas/DDE. Una celda de TEXTO que empieza con
 *  `= + - @` (o tab/CR) la ejecuta Excel/Sheets al abrir el .csv (p. ej. un
 *  cliente llamado `=HYPERLINK(...)`); se antepone `'` para forzarla a texto.
 *  Los NÚMEROS pasan crudos (los generamos nosotros, y el contador debe poder
 *  sumarlos). */
export function csvCampo(v: CeldaCsv): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Arma un CSV (encabezado + filas) con saltos CRLF (estándar de Excel). */
export function filasACsv(encabezados: string[], filas: CeldaCsv[][]): string {
  const linea = (cols: CeldaCsv[]) => cols.map(csvCampo).join(";");
  return [linea(encabezados), ...filas.map(linea)].join("\r\n");
}

/** Antepone el BOM UTF-8 para que Excel abra los acentos correctamente. */
export function conBom(csv: string): string {
  return "﻿" + csv;
}

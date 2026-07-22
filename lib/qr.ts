// ─────────────────────────────────────────────────────────────────────────
//  CÓDIGO QR — matriz de módulos → path SVG.
//
//  Para qué: el cobrador le muestra al cliente el QR de SU cartón; el cliente
//  lo escanea con la cámara y entra sin escribir nada. Es la forma más rápida
//  y menos propensa a error de darlo de alta en la calle.
//
//  Decisiones (importan en el campo):
//   · Se renderiza en el SERVIDOR como SVG plano → 0 JS en el teléfono del
//     cobrador, anda en Android viejo y escala sin pixelarse (canvas no).
//   · Un solo <path> con todos los módulos oscuros: liviano y nítido.
//   · Margen (quiet zone) de 4 módulos: lo pide la norma; sin él muchos
//     lectores no enganchan el código.
//   · Nivel de corrección "M" (15%): el equilibrio estándar para una URL sin
//     logo encima. Menos módulos = módulos más grandes = escanea de más lejos
//     y con peor cámara. NO tapar el QR con un logo (por eso no usamos "H").
//
//  Alcance: entrada ASCII imprimible (una URL). El encoder base mapea byte a
//  byte, así que un texto con acentos saldría mal; `matrizQR` lo rechaza en
//  vez de emitir un QR corrupto.
// ─────────────────────────────────────────────────────────────────────────
import qrcode from "qrcode-generator";

export type NivelQR = "L" | "M" | "Q" | "H";

/** Quiet zone en módulos. La norma ISO/IEC 18004 pide 4. */
export const MARGEN_QR = 4;

export interface MatrizQR {
  /** Módulos por lado (sin el margen). Crece con el largo del texto. */
  lado: number;
  /** Margen (quiet zone) aplicado, en módulos. */
  margen: number;
  /** Lado del viewBox = lado + 2·margen. Todo el dibujo va en estas unidades. */
  vista: number;
  /** Path SVG con TODOS los módulos oscuros, ya desplazado por el margen. */
  path: string;
}

/** ASCII imprimible: el rango en el que vive una URL bien formada. */
const ASCII_IMPRIMIBLE = /^[\x20-\x7E]+$/;

/**
 * Construye la matriz del QR y la devuelve como path SVG listo para dibujar.
 * Lanza si el texto está vacío o no es ASCII (ver nota de alcance arriba).
 */
export function matrizQR(texto: string, nivel: NivelQR = "M"): MatrizQR {
  if (!texto) throw new Error("QR: texto vacío");
  if (!ASCII_IMPRIMIBLE.test(texto)) throw new Error("QR: solo texto ASCII (URLs)");

  const qr = qrcode(0, nivel); // 0 = versión automática: la más chica que entre
  qr.addData(texto); // modo Byte (por defecto)
  qr.make();

  const lado = qr.getModuleCount();
  // Un módulo = un cuadrado de 1×1 en las unidades del viewBox. Concatenar
  // subpaths ("M x y h1 v1 h-1 z") es lo más liviano: un solo nodo <path>.
  let path = "";
  for (let fila = 0; fila < lado; fila++) {
    for (let col = 0; col < lado; col++) {
      if (qr.isDark(fila, col)) {
        path += `M${col + MARGEN_QR} ${fila + MARGEN_QR}h1v1h-1z`;
      }
    }
  }

  return { lado, margen: MARGEN_QR, vista: lado + MARGEN_QR * 2, path };
}

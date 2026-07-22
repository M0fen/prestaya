// Código QR como SVG puro (se arma en el SERVIDOR — ver lib/qr.ts).
// Sin JS ni canvas: anda en teléfonos viejos, escala sin pixelarse y se puede
// imprimir. `crispEdges` evita el suavizado que confunde a las cámaras malas.
import { matrizQR, type NivelQR } from "@/lib/qr";

export function QrCodigo({
  texto,
  tam = 240,
  nivel = "M",
  etiqueta = "Código QR",
  color = "#0F1B3D",
  fondo = "#FFFFFF",
}: {
  texto: string;
  /** Lado en px. Mínimo recomendado en pantalla: 200 px. */
  tam?: number;
  nivel?: NivelQR;
  etiqueta?: string;
  color?: string;
  fondo?: string;
}) {
  const qr = matrizQR(texto, nivel);
  return (
    <svg
      width={tam}
      height={tam}
      viewBox={`0 0 ${qr.vista} ${qr.vista}`}
      role="img"
      aria-label={etiqueta}
      shapeRendering="crispEdges"
      className="block"
    >
      {/* El fondo claro es parte del código: la quiet zone tiene que ser opaca. */}
      <rect width={qr.vista} height={qr.vista} fill={fondo} />
      <path d={qr.path} fill={color} />
    </svg>
  );
}

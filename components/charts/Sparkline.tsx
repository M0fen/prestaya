// Sparkline SVG puro: una línea + área de relleno para mostrar tendencia en
// poco espacio (dentro de un KPI). Sin dependencias ni JS de cliente: escala
// solo, tolera series vacías o planas.
interface Props {
  valores: number[];
  color?: string;
  /** Alto en px del área de dibujo. */
  alto?: number;
  className?: string;
}

export function Sparkline({ valores, color = "#1FA971", alto = 36, className }: Props) {
  const W = 100; // viewBox virtual; el SVG se estira con width:100%
  const H = alto;
  const n = valores.length;
  if (n === 0) return null;

  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const paso = n > 1 ? W / (n - 1) : 0;
  const y = (v: number) => H - 3 - ((v - min) / rango) * (H - 6);

  const puntos = valores.map((v, i) => [n > 1 ? i * paso : W / 2, y(v)] as const);
  const linea = puntos.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${linea} L${W},${H} L0,${H} Z`;
  const idGrad = `sl-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height: alto }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={idGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${idGrad})`} />
      <path d={linea} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

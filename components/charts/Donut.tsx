// Donut SVG puro para mostrar una composición (p. ej. mora por tramo de
// antigüedad, o cartera al día vs vencida). Usa stroke-dasharray sobre círculos
// para los segmentos, con un valor + etiqueta al centro. Sin JS de cliente.
export interface SegmentoDonut {
  etiqueta: string;
  valor: number;
  color: string;
}

interface Props {
  segmentos: SegmentoDonut[];
  /** Texto grande del centro (p. ej. el total formateado). */
  centroValor: string;
  centroEtiqueta?: string;
  tam?: number;
}

export function Donut({ segmentos, centroValor, centroEtiqueta, tam = 148 }: Props) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  const R = 54; // radio del círculo en el viewBox 0..120
  const C = 2 * Math.PI * R;
  const cx = 60;
  const grosor = 16;

  let offset = 0;
  const arcos =
    total > 0
      ? segmentos
          .filter((s) => s.valor > 0)
          .map((s, _i, arr) => {
            const frac = s.valor / total;
            const dash = frac * C;
            // Gap fino entre segmentos (se ve más "premium" que borde con borde).
            const g = arr.length > 1 ? 1.6 : 0;
            const arco = {
              ...s,
              dasharray: `${Math.max(0.1, dash - g)} ${C - dash + g}`,
              dashoffset: -offset,
            };
            offset += dash;
            return arco;
          })
      : [];

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox="0 0 120 120"
        style={{ width: tam, height: tam, flexShrink: 0 }}
        aria-hidden="true"
      >
        {/* Riel de fondo (token → flipea en oscuro) */}
        <circle cx={cx} cy={cx} r={R} fill="none" className="stroke-linea" strokeWidth={grosor} />
        {/* Segmentos (rotados −90° para arrancar arriba) */}
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {arcos.map((a) => (
            <circle
              key={a.etiqueta}
              cx={cx}
              cy={cx}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={grosor}
              strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset}
              strokeLinecap="butt"
            >
              <title>{a.etiqueta}</title>
            </circle>
          ))}
        </g>
        {/* Monto central: token (flipea en oscuro), auto-reduce por largo (millones
            no rozan el anillo) y tabular-nums + tracking ceñido (regla de números). */}
        <text
          x={cx}
          y={cx - 2}
          textAnchor="middle"
          className="fill-tinta"
          style={{
            fontSize: centroValor.length > 10 ? 12 : centroValor.length > 8 ? 13.5 : 15,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {centroValor}
        </text>
        {centroEtiqueta && (
          <text x={cx} y={cx + 14} textAnchor="middle" className="fill-tenue" style={{ fontSize: 8.5, fontWeight: 600 }}>
            {centroEtiqueta}
          </text>
        )}
      </svg>
      <ul className="flex flex-col gap-2">
        {segmentos.map((s) => (
          <li key={s.etiqueta} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-[12px] font-semibold text-gris">{s.etiqueta}</span>
            <span className="ml-1 text-[12px] font-bold tabular-nums text-tinta">
              {total > 0 ? Math.round((s.valor / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

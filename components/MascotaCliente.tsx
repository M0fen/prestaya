// Mascota de la vista del cliente (SVG propio): criatura amable verde-teal que
// crece con el nivel (etapa 0→4). Estática y legible (tono calmo, adultos
// mayores). Sin animación por defecto.
const CUERPO = "#4FB89A";
const CUERPO_OSCURO = "#3F9D80";
const HOJA = "#3F9D80";

function Brote({ etapa }: { etapa: number }) {
  return (
    <g>
      <path
        d={`M80 64 Q79 ${52 - etapa * 2} 80 ${48 - etapa * 3}`}
        stroke={HOJA}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="70" cy="54" rx="9" ry="5" fill={HOJA} transform="rotate(-28 70 54)" />
      {etapa >= 1 && (
        <ellipse cx="90" cy="52" rx="9" ry="5" fill={HOJA} transform="rotate(28 90 52)" />
      )}
      {etapa === 2 && <circle cx="80" cy={44} r="6" fill="#E0A13C" />}
      {etapa >= 3 &&
        [0, 72, 144, 216, 288].map((a) => {
          const rad = (a * Math.PI) / 180;
          return (
            <circle
              key={a}
              cx={80 + Math.cos(rad) * 9}
              cy={40 + Math.sin(rad) * 9}
              r="6"
              fill={etapa >= 4 ? "#CBA14A" : "#E0A13C"}
            />
          );
        })}
      {etapa >= 3 && <circle cx="80" cy="40" r="5.5" fill="#F1E8D2" />}
    </g>
  );
}

export function MascotaCliente({
  etapa,
  size = 120,
}: {
  etapa: number;
  size?: number;
}) {
  return (
    <svg viewBox="0 0 160 175" width={size} height={size} role="img" aria-label="Tu mascota">
      <Brote etapa={etapa} />
      <ellipse cx="80" cy="162" rx="40" ry="7" fill="rgba(0,0,0,0.12)" />
      <ellipse cx="80" cy="112" rx="53" ry="50" fill={CUERPO} />
      <ellipse cx="80" cy="126" rx="34" ry="28" fill="#5FC7A8" opacity="0.55" />
      <ellipse cx="62" cy="158" rx="11" ry="7" fill={CUERPO_OSCURO} />
      <ellipse cx="98" cy="158" rx="11" ry="7" fill={CUERPO_OSCURO} />
      <circle cx="63" cy="106" r="14" fill="#fff" />
      <circle cx="97" cy="106" r="14" fill="#fff" />
      <circle cx="65" cy="108" r="6.5" fill="#22303A" />
      <circle cx="99" cy="108" r="6.5" fill="#22303A" />
      <circle cx="67" cy="105" r="2.2" fill="#fff" />
      <circle cx="101" cy="105" r="2.2" fill="#fff" />
      <ellipse cx="50" cy="122" rx="8" ry="5" fill="#EF9A9A" opacity="0.6" />
      <ellipse cx="110" cy="122" rx="8" ry="5" fill="#EF9A9A" opacity="0.6" />
      <path d="M68 124 Q80 137 92 124 Q80 132 68 124" fill="#22303A" />
    </svg>
  );
}

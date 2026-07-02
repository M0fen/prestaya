// Criatura SVG expresiva de la mascota. Un mismo "plan corporal" (blob) que
// cambia según la especie (paleta + orejas + cola) y muestra distintas
// EXPRESIONES para reaccionar a las caricias/juego. Presentacional y puro.
import { especiePorId, type Expresion, type OrejaEspecie } from "@/lib/mascota";

interface Props {
  especieId: string;
  etapa: number; // 0..4, crece con los pagos reales
  expresion: Expresion;
  accesorio?: string;
  size?: number;
}

export function Criatura({ especieId, etapa, expresion, accesorio = "ninguno", size = 132 }: Props) {
  const e = especiePorId(especieId);
  const { cuerpo, sombra, panza, mejilla } = e.paleta;
  const mostrarBlush = expresion === "feliz" || expresion === "contento";

  return (
    <svg viewBox="0 0 160 178" width={size} height={size} role="img" aria-label={`Mascota ${e.nombre}`}>
      {/* Aura por nivel alto (crecimiento por pagos) */}
      {etapa >= 4 && <circle cx="80" cy="110" r="66" fill="#F6E3A8" opacity="0.35" />}
      {etapa >= 2 &&
        [-1, 1].map((s) => (
          <text key={s} x={80 + s * 60} y={70 + s * 8} fontSize="13" textAnchor="middle" opacity="0.7">
            ✨
          </text>
        ))}

      {/* Cola (detrás del cuerpo) */}
      {e.cola && (
        <path
          d="M126 132 Q150 128 146 108 Q142 120 124 122 Z"
          fill={sombra}
          className="py-cola"
          style={{ transformOrigin: "126px 128px" }}
        />
      )}

      {/* Orejas / brote (según especie) */}
      <Orejas tipo={e.orejas} etapa={etapa} cuerpo={cuerpo} sombra={sombra} />

      {/* Sombra en el piso */}
      <ellipse cx="80" cy="166" rx="40" ry="7" fill="rgba(0,0,0,0.12)" />

      {/* Cuerpo */}
      <ellipse cx="80" cy="114" rx="53" ry="50" fill={cuerpo} />
      <ellipse cx="80" cy="128" rx="34" ry="27" fill={panza} opacity="0.6" />
      {/* Piecitos */}
      <ellipse cx="62" cy="160" rx="11" ry="7" fill={sombra} />
      <ellipse cx="98" cy="160" rx="11" ry="7" fill={sombra} />

      {/* Cara según expresión */}
      <Cara expresion={expresion} mejilla={mejilla} mostrarBlush={mostrarBlush} pico={e.orejas === "ave"} />

      {/* Accesorio en la cabeza */}
      <Accesorio id={accesorio} />
    </svg>
  );
}

function Orejas({
  tipo,
  etapa,
  cuerpo,
  sombra,
}: {
  tipo: OrejaEspecie;
  etapa: number;
  cuerpo: string;
  sombra: string;
}) {
  if (tipo === "brote") {
    const HOJA = sombra;
    return (
      <g className="py-orejas" style={{ transformOrigin: "80px 66px" }}>
        <path d={`M80 66 Q79 ${54 - etapa * 2} 80 ${50 - etapa * 3}`} stroke={HOJA} strokeWidth="5" strokeLinecap="round" fill="none" />
        <ellipse cx="70" cy="56" rx="9" ry="5" fill={HOJA} transform="rotate(-28 70 56)" />
        {etapa >= 1 && <ellipse cx="90" cy="54" rx="9" ry="5" fill={HOJA} transform="rotate(28 90 54)" />}
      </g>
    );
  }
  if (tipo === "gato") {
    return (
      <g className="py-orejas" style={{ transformOrigin: "80px 70px" }}>
        <path d="M48 78 L44 44 L74 66 Z" fill={cuerpo} />
        <path d="M112 78 L116 44 L86 66 Z" fill={cuerpo} />
        <path d="M52 72 L50 54 L66 66 Z" fill={sombra} opacity="0.7" />
        <path d="M108 72 L110 54 L94 66 Z" fill={sombra} opacity="0.7" />
      </g>
    );
  }
  if (tipo === "conejo") {
    return (
      <g className="py-orejas" style={{ transformOrigin: "80px 76px" }}>
        <ellipse cx="64" cy="44" rx="9" ry="26" fill={cuerpo} transform="rotate(-12 64 44)" />
        <ellipse cx="96" cy="44" rx="9" ry="26" fill={cuerpo} transform="rotate(12 96 44)" />
        <ellipse cx="64" cy="46" rx="4" ry="18" fill={sombra} opacity="0.6" transform="rotate(-12 64 46)" />
        <ellipse cx="96" cy="46" rx="4" ry="18" fill={sombra} opacity="0.6" transform="rotate(12 96 46)" />
      </g>
    );
  }
  // ave: penacho de plumitas
  return (
    <g className="py-orejas" style={{ transformOrigin: "80px 68px" }}>
      <path d="M80 66 Q72 48 80 40 Q88 48 80 66" fill={cuerpo} />
      <path d="M80 64 Q68 52 66 42 Q80 50 80 64" fill={sombra} opacity="0.7" />
      <path d="M80 64 Q92 52 94 42 Q80 50 80 64" fill={sombra} opacity="0.7" />
    </g>
  );
}

function Cara({
  expresion,
  mejilla,
  mostrarBlush,
  pico,
}: {
  expresion: Expresion;
  mejilla: string;
  mostrarBlush: boolean;
  pico: boolean;
}) {
  const ojoIzq = 63;
  const ojoDer = 97;
  const ojoY = 108;

  const ojos = () => {
    if (expresion === "dormido") {
      return (
        <>
          <path d={`M${ojoIzq - 8} ${ojoY} q8 6 16 0`} stroke="#22303A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d={`M${ojoDer - 8} ${ojoY} q8 6 16 0`} stroke="#22303A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <text x="118" y="86" fontSize="14" fill="#8A93AD">z</text>
        </>
      );
    }
    if (expresion === "feliz") {
      return (
        <>
          <path d={`M${ojoIzq - 9} ${ojoY + 2} q9 -11 18 0`} stroke="#22303A" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d={`M${ojoDer - 9} ${ojoY + 2} q9 -11 18 0`} stroke="#22303A" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      );
    }
    // normal / contento / triste: ojos redondos vivos
    const r = expresion === "triste" ? 6 : 7;
    return (
      <>
        <circle cx={ojoIzq} cy={ojoY} r="14" fill="#fff" />
        <circle cx={ojoDer} cy={ojoY} r="14" fill="#fff" />
        <circle cx={ojoIzq + 2} cy={ojoY + 2} r={r} fill="#22303A" />
        <circle cx={ojoDer + 2} cy={ojoY + 2} r={r} fill="#22303A" />
        <circle cx={ojoIzq + 4} cy={ojoY - 1} r="2.3" fill="#fff" />
        <circle cx={ojoDer + 4} cy={ojoY - 1} r="2.3" fill="#fff" />
      </>
    );
  };

  const boca = () => {
    if (pico) {
      // Piquito naranja en vez de boca
      return <path d="M74 126 L86 126 L80 134 Z" fill="#E8933C" />;
    }
    if (expresion === "feliz" || expresion === "contento") {
      return (
        <g>
          <path d="M66 122 Q80 142 94 122 Z" fill="#22303A" />
          <path d="M76 134 Q80 139 84 134 Z" fill="#EF7E7E" />
        </g>
      );
    }
    if (expresion === "dormido") {
      return <ellipse cx="80" cy="128" rx="4" ry="3" fill="#22303A" opacity="0.7" />;
    }
    if (expresion === "triste") {
      return <path d="M72 130 Q80 126 88 130" stroke="#22303A" strokeWidth="2.6" fill="none" strokeLinecap="round" />;
    }
    return <path d="M69 125 Q80 135 91 125" stroke="#22303A" strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  };

  return (
    <g className="py-cara">
      {ojos()}
      {mostrarBlush && (
        <>
          <ellipse cx="50" cy="124" rx="8" ry="5" fill={mejilla} opacity="0.55" />
          <ellipse cx="110" cy="124" rx="8" ry="5" fill={mejilla} opacity="0.55" />
        </>
      )}
      {boca()}
    </g>
  );
}

function Accesorio({ id }: { id: string }) {
  if (id === "moño")
    return (
      <g>
        <path d="M96 62 l14 -8 v16 z" fill="#EF6F8E" />
        <path d="M124 62 l-14 -8 v16 z" fill="#EF6F8E" />
        <circle cx="110" cy="62" r="4.5" fill="#D65179" />
      </g>
    );
  if (id === "gorro")
    return (
      <g>
        <path d="M52 60 Q80 34 108 60 Z" fill="#2453DC" />
        <rect x="50" y="58" width="60" height="7" rx="3.5" fill="#13308C" />
        <circle cx="80" cy="34" r="5" fill="#EAF0FF" />
      </g>
    );
  if (id === "flor")
    return (
      <g transform="translate(104 54)">
        {[0, 72, 144, 216, 288].map((a) => {
          const rad = (a * Math.PI) / 180;
          return <circle key={a} cx={Math.cos(rad) * 7} cy={Math.sin(rad) * 7} r="5" fill="#F49AC2" />;
        })}
        <circle cx="0" cy="0" r="4.5" fill="#F6D74E" />
      </g>
    );
  if (id === "corona")
    return (
      <g>
        <path d="M58 58 L64 40 L72 52 L80 36 L88 52 L96 40 L102 58 Z" fill="#F3C743" stroke="#D9A825" strokeWidth="1.5" />
        <circle cx="80" cy="46" r="3" fill="#E8607A" />
      </g>
    );
  if (id === "lentes")
    return (
      <g>
        <rect x="49" y="100" width="26" height="16" rx="6" fill="#22303A" />
        <rect x="85" y="100" width="26" height="16" rx="6" fill="#22303A" />
        <rect x="73" y="105" width="14" height="4" rx="2" fill="#22303A" />
        <rect x="52" y="103" width="9" height="4" rx="2" fill="#4a5a66" />
      </g>
    );
  return null;
}

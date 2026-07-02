// Mapa geográfico de los cobros del día. Proyecta el GPS real (equirectangular
// con corrección por latitud, así las distancias no se deforman) sobre una
// retícula con coordenadas y una barra de escala en km → se ve DÓNDE se cobró y
// cómo se reparten las zonas. Marca el domicilio del cliente y, si el cobro cayó
// fuera de la geo-cerca, dibuja la "fuga" (línea punteada). Incluye un
// localizador de Uruguay. SVG puro (sin dependencias ni tiles).
import type { PuntoCobro } from "@/lib/data/control";

const W = 340;
const H = 280;
const PAD = 34;

// Bordes aproximados de Uruguay (para ubicar el punto en el país).
const UY = { latN: -30.0, latS: -35.05, lngO: -58.5, lngE: -53.0 };
// Silueta simplificada de Uruguay (viewBox 0..100), solo como referencia visual.
const UY_PATH =
  "M10,6 L30,4 L46,4 L60,12 L78,26 L92,40 L82,50 L74,58 L66,66 L50,74 L36,72 L26,70 L18,55 L15,42 L12,24 Z";

function paso(span: number): number {
  const raw = span / 3 || 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

const fmtLng = (l: number) => `${Math.abs(l).toFixed(2)}°O`;
const fmtLat = (l: number) => `${Math.abs(l).toFixed(2)}°S`;

export function MapaCobros({ puntos }: { puntos: PuntoCobro[] }) {
  if (puntos.length === 0) {
    return (
      <div className="flex aspect-[5/4] w-full items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#E8EEF7,#DBE4F2)] text-[12px] font-medium text-gris">
        Sin cobros con GPS hoy
      </div>
    );
  }

  // Coordenadas a considerar (cobros + domicilios) para encuadrar.
  const coords: { lat: number; lng: number }[] = [];
  for (const p of puntos) {
    coords.push({ lat: p.lat, lng: p.lng });
    if (p.casaLat != null && p.casaLng != null) coords.push({ lat: p.casaLat, lng: p.casaLng });
  }
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cosC = Math.cos((midLat * Math.PI) / 180);

  // Proyección aspect-correct: x = lng·cos(lat), y = lat.
  const xr = (lng: number) => lng * cosC;
  const xs = lngs.map(xr);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...lats), maxY = Math.max(...lats);
  // Span mínimo (~1 km) para que un punto único no quede infinitamente ampliado.
  const MIN_SPAN = 0.012;
  if (maxX - minX < MIN_SPAN * cosC) { const c = (minX + maxX) / 2, h = (MIN_SPAN * cosC) / 2; minX = c - h; maxX = c + h; }
  if (maxY - minY < MIN_SPAN) { const c = (minY + maxY) / 2, h = MIN_SPAN / 2; minY = c - h; maxY = c + h; }
  const spanX = maxX - minX, spanY = maxY - minY;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const midX = (minX + maxX) / 2, midYc = (minY + maxY) / 2;
  const px = (lng: number) => W / 2 + (xr(lng) - midX) * scale;
  const py = (lat: number) => H / 2 - (lat - midYc) * scale;

  // Retícula (líneas de lat/lng "redondas").
  const stepLng = paso((maxX - minX) / cosC);
  const stepLat = paso(spanY);
  const lngLines: number[] = [];
  for (let l = Math.ceil((minX / cosC) / stepLng) * stepLng; l <= maxX / cosC; l += stepLng) lngLines.push(l);
  const latLines: number[] = [];
  for (let l = Math.ceil(minY / stepLat) * stepLat; l <= maxY; l += stepLat) latLines.push(l);

  // Barra de escala: metros por px (vertical). 1° lat ≈ 111.320 m.
  const mPorPx = 111320 / scale;
  const objetivo = (W / 4) * mPorPx; // ~un cuarto de ancho
  const opciones = [100, 200, 500, 1000, 2000, 5000, 10000];
  const barM = opciones.reduce((a, b) => (Math.abs(b - objetivo) < Math.abs(a - objetivo) ? b : a));
  const barPx = barM / mPorPx;
  const barLabel = barM >= 1000 ? `${barM / 1000} km` : `${barM} m`;

  // Localizador en Uruguay.
  const locX = ((midLat && lngs.length ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : -56.2) - UY.lngO) / (UY.lngE - UY.lngO) * 100;
  const locY = (UY.latN - midLat) / (UY.latN - UY.latS) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full overflow-hidden rounded-[14px] border border-[#DCE6F4]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ background: "linear-gradient(160deg,#EAF1FB,#DCE7F5)" }}>
          {/* Retícula */}
          {lngLines.map((l) => {
            const x = px(l);
            return (
              <g key={`v${l}`}>
                <line x1={x} y1={PAD} x2={x} y2={H - PAD} stroke="#C7D6EC" strokeWidth="1" />
                <text x={x} y={H - PAD + 12} textAnchor="middle" style={{ fontSize: 8, fill: "#8A93AD" }}>{fmtLng(l)}</text>
              </g>
            );
          })}
          {latLines.map((l) => {
            const y = py(l);
            return (
              <g key={`h${l}`}>
                <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#C7D6EC" strokeWidth="1" />
                <text x={PAD - 4} y={y + 3} textAnchor="end" style={{ fontSize: 8, fill: "#8A93AD" }}>{fmtLat(l)}</text>
              </g>
            );
          })}

          {/* Fugas (cobro fuera de zona → domicilio) */}
          {puntos.map((p, i) =>
            p.enZona === false && p.casaLat != null && p.casaLng != null ? (
              <line
                key={`f${i}`}
                x1={px(p.lng)} y1={py(p.lat)} x2={px(p.casaLng)} y2={py(p.casaLat)}
                stroke="#E74C3C" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.8"
              />
            ) : null,
          )}

          {/* Domicilios (casita) */}
          {puntos.map((p, i) =>
            p.casaLat != null && p.casaLng != null ? (
              <circle key={`c${i}`} cx={px(p.casaLng)} cy={py(p.casaLat)} r="3.2" fill="none" stroke="#5B6478" strokeWidth="1.4" opacity="0.7" />
            ) : null,
          )}

          {/* Cobros */}
          {puntos.map((p, i) => {
            const color = p.enZona === false ? "#E74C3C" : p.enZona === true ? "#2F9E63" : "#8A93AD";
            return (
              <g key={`p${i}`}>
                <circle cx={px(p.lng)} cy={py(p.lat)} r="9" fill={color} opacity="0.16" />
                <circle cx={px(p.lng)} cy={py(p.lat)} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5">
                  <title>{`${p.clienteNombre}${p.cobradorNombre ? ` · ${p.cobradorNombre}` : ""}${p.enZona === false ? " · FUERA DE ZONA" : p.enZona === true ? " · en zona" : ""}`}</title>
                </circle>
              </g>
            );
          })}

          {/* Barra de escala */}
          <g transform={`translate(${W - PAD - barPx} ${H - PAD - 8})`}>
            <line x1="0" y1="0" x2={barPx} y2="0" stroke="#3A445F" strokeWidth="2" />
            <line x1="0" y1="-3" x2="0" y2="3" stroke="#3A445F" strokeWidth="2" />
            <line x1={barPx} y1="-3" x2={barPx} y2="3" stroke="#3A445F" strokeWidth="2" />
            <text x={barPx / 2} y="-5" textAnchor="middle" style={{ fontSize: 8.5, fontWeight: 700, fill: "#3A445F" }}>{barLabel}</text>
          </g>

          {/* Localizador de Uruguay */}
          <g transform={`translate(${W - 60} ${PAD - 6}) scale(0.42)`}>
            <rect x="-6" y="-6" width="112" height="112" rx="8" fill="#ffffffcc" />
            <path d={UY_PATH} fill="#DCE7F5" stroke="#9DB2D4" strokeWidth="1.5" />
            <circle cx={Math.max(4, Math.min(96, locX))} cy={Math.max(4, Math.min(96, locY))} r="5" fill="#2453DC" stroke="#fff" strokeWidth="1.5" />
            <text x="50" y="112" textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: "#6B7494" }}>Uruguay</text>
          </g>
        </svg>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-gris">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2F9E63]" /> En zona</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#E74C3C]" /> Fuera de zona</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#5B6478]" /> Domicilio</span>
        <span className="flex items-center gap-1.5"><span className="text-[#E74C3C]">┅</span> Fuga</span>
      </div>
    </div>
  );
}

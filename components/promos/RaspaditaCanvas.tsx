"use client";
// Raspadita PROFESIONAL — canvas propio (sin librería). Se rasca con el dedo:
// una capa plateada con textura se borra con `destination-out` al mover el
// puntero; al llegar al ~60% raspado, se revela sola con un pop.
//
// ⚠️ El PREMIO lo decide y registra el SERVIDOR (jugarRaspadita) al PRIMER
// raspado; el canvas solo revela un resultado ya definido. Las probabilidades
// nunca viajan al cliente. Sin dinero real (beneficio simbólico o "nada").
import { useCallback, useEffect, useRef, useState } from "react";
import { jugarRaspadita } from "@/app/c/[token]/actions";

type Premio = { label: string; tipo: "beneficio" | "nada" };

const UMBRAL_REVELAR = 0.6; // hay que raspar el 60% (no se abre de un toque)
const RADIO_PINCEL = 22; // yema del dedo

export function RaspaditaCanvas({
  token,
  disponibles,
}: {
  token: string | null;
  disponibles: number;
}) {
  const [premio, setPremio] = useState<Premio | null>(null);
  const [revelado, setRevelado] = useState(false);
  const [error, setError] = useState("");
  const [soporta, setSoporta] = useState(true);
  const [jugadasLocal, setJugadasLocal] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const iniciado = useRef(false);
  const movs = useRef(0);
  const alcanzoUmbral = useRef(false);

  const restantes = disponibles - jugadasLocal;

  // ── Dibuja la cobertura plateada con textura ─────────────────────────────
  const pintarCobertura = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setSoporta(false);
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Base metálica.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#C2C8D2");
    g.addColorStop(0.45, "#E7EBF1");
    g.addColorStop(0.55, "#D3D8E1");
    g.addColorStop(1, "#AEB5C2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Brillo diagonal.
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.4)");
    sheen.addColorStop(0.6, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    // Grano/ruido tenue.
    ctx.globalAlpha = 0.06;
    const puntos = Math.floor((w * h) / 90);
    for (let i = 0; i < puntos; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#000" : "#fff";
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    ctx.globalAlpha = 1;
    // Pista.
    ctx.fillStyle = "rgba(88,98,120,0.6)";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✦ Raspá aquí ✦", w / 2, h / 2);
    movs.current = 0;
    alcanzoUmbral.current = false;
  }, []);

  useEffect(() => {
    pintarCobertura();
    const onResize = () => !revelado && pintarCobertura();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jugadasLocal]);

  // ── Revelado ─────────────────────────────────────────────────────────────
  const revelar = useCallback(() => {
    if (revelado) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setRevelado(true);
  }, [revelado]);

  // Si se llegó al umbral pero el premio aún no había llegado, revelar al llegar.
  useEffect(() => {
    if (premio && alcanzoUmbral.current && !revelado) revelar();
  }, [premio, revelado, revelar]);

  // ── Pide el premio al servidor en el PRIMER raspado ──────────────────────
  const iniciar = useCallback(async () => {
    if (iniciado.current || !token) return;
    iniciado.current = true;
    const r = await jugarRaspadita({ token });
    if (r.ok) {
      setPremio({ label: r.label, tipo: r.tipo });
      setJugadasLocal((n) => n + 1);
    } else {
      setError(r.error);
    }
  }, [token]);

  // ── Borrado táctil ───────────────────────────────────────────────────────
  const posicion = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const borrar = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    const grad = ctx.createRadialGradient(x, y, 0, x, y, RADIO_PINCEL);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.7, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    // Leve irregularidad para que no sea un círculo perfecto.
    ctx.arc(x, y, RADIO_PINCEL + (Math.random() * 3 - 1.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  };

  const medirPct = (): number => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return 0;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transp = 0;
    let tot = 0;
    // Muestreo cada 20 píxeles (barato para gama baja).
    for (let i = 3; i < img.length; i += 4 * 20) {
      tot++;
      if (img[i] < 128) transp++;
    }
    return tot ? transp / tot : 0;
  };

  const onDown = (e: React.PointerEvent) => {
    if (revelado || error) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    if (!iniciado.current) void iniciar();
    const { x, y } = posicion(e);
    borrar(x, y);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dibujando.current || revelado) return;
    const { x, y } = posicion(e);
    borrar(x, y);
    movs.current += 1;
    if (movs.current % 6 === 0) {
      const pct = medirPct();
      if (pct >= UMBRAL_REVELAR) {
        alcanzoUmbral.current = true;
        if (premio) revelar();
      }
    }
  };

  const onUp = () => {
    dibujando.current = false;
  };

  const otra = () => {
    setPremio(null);
    setRevelado(false);
    setError("");
    iniciado.current = false;
    requestAnimationFrame(pintarCobertura);
  };

  // ── Sin token (demo): estado deshabilitado ───────────────────────────────
  const jugable = Boolean(token) && restantes > 0;

  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E7DCF7] bg-[linear-gradient(135deg,#7B4DE0,#5B2FC0)] p-4 text-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-extrabold">🎟️ Raspadita</span>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold">
          {Math.max(0, restantes)} disponible{restantes === 1 ? "" : "s"}
        </span>
      </div>

      {/* Zona de raspado: premio debajo, canvas encima */}
      <div
        ref={wrapRef}
        className="relative h-[128px] w-full overflow-hidden rounded-[14px] bg-white/12 select-none"
      >
        {/* Premio (debajo) — legible siempre */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
          {error ? (
            <span className="text-[13px] font-semibold text-[#FFD9D9]">{error}</span>
          ) : premio ? (
            <div className={revelado ? "py-carita flex flex-col items-center gap-1" : "flex flex-col items-center gap-1"}>
              <span className="text-[30px]">{premio.tipo === "beneficio" ? "🎉" : "🍀"}</span>
              <span className="text-[15px] font-extrabold">{premio.label}</span>
              {premio.tipo === "beneficio" && (
                <span className="text-[11px] font-medium text-white/80">Mostralo en la oficina para usarlo.</span>
              )}
            </div>
          ) : (
            <span className="text-[12.5px] font-medium text-white/70">
              {jugable ? "Tu premio está acá abajo…" : "Disponible en tu app"}
            </span>
          )}
        </div>

        {/* Canvas de la cobertura (encima). Fallback: botón si no hay canvas. */}
        {soporta && jugable && !revelado && (
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            className="absolute inset-0 cursor-pointer"
            style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
            aria-label="Raspá para descubrir tu premio"
          />
        )}

        {/* Fallback accesible (sin canvas): revelar con un toque */}
        {!soporta && jugable && !revelado && (
          <button
            type="button"
            onClick={() => {
              void iniciar();
              setTimeout(() => setRevelado(true), 250);
            }}
            className="absolute inset-0 flex items-center justify-center bg-white/15 text-[14px] font-extrabold text-white"
          >
            Tocá para revelar
          </button>
        )}
      </div>

      {/* Raspar otra si quedan */}
      {revelado && restantes > 0 && (
        <button
          type="button"
          onClick={otra}
          className="mt-3 w-full rounded-[12px] bg-white/15 py-2.5 text-[13px] font-extrabold text-white active:scale-[0.98]"
        >
          Raspar otra ({restantes})
        </button>
      )}
    </div>
  );
}

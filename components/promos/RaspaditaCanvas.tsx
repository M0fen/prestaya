"use client";
// Raspadita PROFESIONAL — canvas propio (sin librería). Una lámina metálica
// (tipo scratch-off real) que se BORRA raspando con el dedo: `destination-out`
// al mover el puntero. Cuesta raspar (pincel chico, umbral alto), vibra un
// poquito al raspar (feel táctil) y recién al ~65% se revela sola con un pop.
//
// ⚠️ El PREMIO lo decide y registra el SERVIDOR (jugarRaspadita) al PRIMER
// raspado; el canvas solo revela un resultado ya definido. Sin token = modo
// demo (premio de muestra local). Sin dinero real (beneficio simbólico o "nada").
import { useCallback, useEffect, useRef, useState } from "react";
import { jugarRaspadita } from "@/app/c/[token]/actions";

type Premio = { label: string; tipo: "beneficio" | "nada" };

const UMBRAL_REVELAR = 0.6; // hay que raspar el 60% del área
const RADIO_PINCEL = 15; // yema del dedo, chico → cuesta más raspar
const MIN_RASCADO_PX = 1200; // distancia mínima a raspar (mover el dedo de un lado a otro)

// Premios de MUESTRA para la vista demo (sin token): solo para "sentir" el
// raspado. No escriben nada en el servidor; el juego real usa jugarRaspadita.
const DEMO_PREMIOS: Premio[] = [
  { label: "¡Seguí participando!", tipo: "nada" },
  { label: "5% en tu próxima cuota", tipo: "beneficio" },
  { label: "1 día de gracia", tipo: "beneficio" },
];

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
  const [ronda, setRonda] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const iniciado = useRef(false);
  const movs = useRef(0);
  const alcanzoUmbral = useRef(false);
  const ultimoPunto = useRef<{ x: number; y: number } | null>(null);
  const rascadoPx = useRef(0); // distancia total raspada (barrera anti "un toque")

  const restantes = disponibles - jugadasLocal;

  // ── Dibuja la LÁMINA metálica (scratch-off) con textura ──────────────────
  const pintarCobertura = useCallback((intentos = 0) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if ((w === 0 || h === 0) && intentos < 10) {
      // El layout aún no midió: reintentar el próximo frame (evita lámina vacía).
      requestAnimationFrame(() => pintarCobertura(intentos + 1));
      return;
    }
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
    ctx.globalCompositeOperation = "source-over";

    // 1) Base metálica (gris plateado con degradé diagonal).
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#9BA1AD");
    g.addColorStop(0.35, "#C9CED7");
    g.addColorStop(0.5, "#EBEEF3");
    g.addColorStop(0.65, "#C4C9D3");
    g.addColorStop(1, "#969CA8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 2) "Metal cepillado": líneas diagonales finas semitransparentes.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    for (let x = -h; x < w; x += 3) {
      ctx.strokeStyle = (x / 3) % 2 === 0 ? "rgba(255,255,255,0.22)" : "rgba(90,98,115,0.14)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
    ctx.restore();

    // 3) Brillo radial (reflejo arriba-izquierda).
    const sh = ctx.createRadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.7);
    sh.addColorStop(0, "rgba(255,255,255,0.35)");
    sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, w, h);

    // 4) Grano/ruido (partículas del material).
    ctx.globalAlpha = 0.08;
    const puntos = Math.floor((w * h) / 60);
    for (let i = 0; i < puntos; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#000" : "#fff";
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    ctx.globalAlpha = 1;

    // 5) Marca "RASPÁ AQUÍ".
    ctx.fillStyle = "rgba(70,78,96,0.55)";
    ctx.font = "800 14px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🪙  RASPÁ AQUÍ", w / 2, h / 2);

    movs.current = 0;
    rascadoPx.current = 0;
    alcanzoUmbral.current = false;
    ultimoPunto.current = null;
  }, []);

  // Ref-callback: pinta la lámina EN CUANTO el canvas existe (al montar y en cada
  // ronda por el key), sin depender del timing de los efectos → nunca queda
  // transparente (que era lo que la hacía "revelarse al tocar").
  const setCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (node) requestAnimationFrame(() => pintarCobertura());
    },
    [pintarCobertura],
  );

  useEffect(() => {
    const onResize = () => {
      if (!revelado && !dibujando.current) pintarCobertura();
    };
    window.addEventListener("resize", onResize);
    // ResizeObserver: repinta cuando el contenedor recibe su tamaño real.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && wrapRef.current) {
      ro = new ResizeObserver(() => {
        if (!revelado && !dibujando.current) pintarCobertura();
      });
      ro.observe(wrapRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ronda]);

  // ── Revelado ─────────────────────────────────────────────────────────────
  const revelar = useCallback(() => {
    if (revelado) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setRevelado(true);
    try {
      navigator.vibrate?.(30);
    } catch {
      /* noop */
    }
  }, [revelado]);

  useEffect(() => {
    if (premio && alcanzoUmbral.current && !revelado) revelar();
  }, [premio, revelado, revelar]);

  // ── Decide el premio en el PRIMER raspado ────────────────────────────────
  const iniciar = useCallback(async () => {
    if (iniciado.current) return;
    iniciado.current = true;
    if (!token) {
      setPremio(DEMO_PREMIOS[Math.floor(Math.random() * DEMO_PREMIOS.length)]);
      setJugadasLocal((n) => n + 1);
      return;
    }
    const r = await jugarRaspadita({ token });
    if (r.ok) {
      setPremio({ label: r.label, tipo: r.tipo });
      setJugadasLocal((n) => n + 1);
    } else {
      setError(r.error);
    }
  }, [token]);

  // ── Borrado táctil (raspado) ─────────────────────────────────────────────
  const posicion = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Borra un círculo (con leve jitter, borde algo duro para sentir el material).
  const borrarPunto = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const r = RADIO_PINCEL + (Math.random() * 3 - 1.5);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.85, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const borrar = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "destination-out";
    // Interpola entre el último punto y el actual → traza continua sin huecos.
    const prev = ultimoPunto.current;
    if (prev) {
      const dist = Math.hypot(x - prev.x, y - prev.y);
      rascadoPx.current += dist; // acumula cuánto se raspó (barrera de revelado)
      const pasos = Math.max(1, Math.floor(dist / (RADIO_PINCEL / 2)));
      for (let i = 1; i <= pasos; i++) {
        borrarPunto(ctx, prev.x + ((x - prev.x) * i) / pasos, prev.y + ((y - prev.y) * i) / pasos);
      }
    } else {
      borrarPunto(ctx, x, y);
    }
    ctx.globalCompositeOperation = "source-over";
    ultimoPunto.current = { x, y };
  };

  const medirPct = (): number => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return 0;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transp = 0;
    let tot = 0;
    for (let i = 3; i < img.length; i += 4 * 16) {
      tot++;
      if (img[i] < 128) transp++;
    }
    return tot ? transp / tot : 0;
  };

  const onDown = (e: React.PointerEvent) => {
    if (revelado || error) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    ultimoPunto.current = null;
    if (!iniciado.current) void iniciar();
    const { x, y } = posicion(e);
    borrar(x, y);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dibujando.current || revelado) return;
    const { x, y } = posicion(e);
    borrar(x, y);
    movs.current += 1;
    // Vibración corta y espaciada → "se siente" la raspada sin marear.
    if (movs.current % 4 === 0) {
      try {
        navigator.vibrate?.(6);
      } catch {
        /* noop */
      }
    }
    if (movs.current % 8 === 0) {
      // Se revela SOLO si raspó buena parte (pct) Y movió el dedo bastante
      // (distancia). La barrera de distancia evita cualquier "revelado de un toque".
      const pct = medirPct();
      if (pct >= UMBRAL_REVELAR && rascadoPx.current >= MIN_RASCADO_PX) {
        alcanzoUmbral.current = true;
        if (premio) revelar();
      }
    }
  };

  const onUp = () => {
    dibujando.current = false;
    ultimoPunto.current = null;
  };

  const otra = () => {
    setPremio(null);
    setRevelado(false);
    setError("");
    iniciado.current = false;
    alcanzoUmbral.current = false;
    movs.current = 0;
    setRonda((r) => r + 1);
  };

  const jugable = restantes > 0;

  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E7DCF7] bg-[linear-gradient(135deg,#7B4DE0,#5B2FC0)] p-4 text-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-extrabold">🎟️ Raspadita</span>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold">
          {Math.max(0, restantes)} disponible{restantes === 1 ? "" : "s"}
        </span>
      </div>

      {/* Zona de raspado: premio debajo, lámina encima */}
      <div
        ref={wrapRef}
        className="relative h-[150px] w-full overflow-hidden rounded-[14px] bg-white/12 select-none"
      >
        {/* Premio (debajo) — legible siempre */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
          {error ? (
            <span className="text-[13px] font-semibold text-[#FFD9D9]">{error}</span>
          ) : premio ? (
            <div className={revelado ? "py-carita flex flex-col items-center gap-1" : "flex flex-col items-center gap-1"}>
              <span className="text-[32px]">{premio.tipo === "beneficio" ? "🎉" : "🍀"}</span>
              <span className="text-[16px] font-extrabold">{premio.label}</span>
              {premio.tipo === "beneficio" && (
                <span className="text-[11px] font-medium text-white/80">Mostralo en la oficina para usarlo.</span>
              )}
            </div>
          ) : (
            <span className="text-[12.5px] font-medium text-white/70">
              {jugable ? "Raspá con el dedo para descubrir tu premio" : "¡Con tu próximo pago desbloqueás otra! 🌟"}
            </span>
          )}
        </div>

        {/* Lámina metálica (encima). Fallback: botón si no hay canvas. */}
        {soporta && jugable && !revelado && (
          <canvas
            key={ronda}
            ref={setCanvas}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onPointerCancel={onUp}
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

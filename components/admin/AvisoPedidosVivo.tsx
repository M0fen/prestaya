"use client";
// ─────────────────────────────────────────────────────────────────────────
//  FRANJA "🔔 pedidos de la calle" — EN VIVO, sin activar nada.
//
//  Quejas repetidas del piloto (19-08): el cobrador pedía renovar/vender por
//  más del +20% y el supervisor no se enteraba. El push exige que el supervisor
//  toque "Activar avisos" (0 activados en toda la base); Carlos: "que en su
//  pantalla aparezcan de forma ágil SIN tener que activar nada por ahora".
//
//  Cómo se entera, en orden de velocidad:
//   1. Supabase Realtime sobre `solicitudes_renovacion` (0151): el INSERT del
//      pedido dispara una relectura al instante (la RLS 0140 filtra por zona).
//   2. Al volver a la pestaña/app (visibilitychange + focus): relee — en el
//      celular el socket se duerme en segundo plano, y esto lo cubre.
//   3. Cada 45 s, por si 1 y 2 fallan (red del local, proxy, etc.).
//  Y lo que hace cuando entra uno NUEVO: toast con el detalle (toca → Pedidos),
//  vibración y un timbre corto. La franja queda fija arriba, en cualquier
//  pantalla del panel, hasta que no quede ninguno pendiente. En
//  /admin/renovaciones no se pinta (ya está ahí) pero la lista se refresca sola.
//
//  ⚠️ La relectura puede FALLAR EN TRANSPORTE (sin señal, o el panel quedó
//  abierto a través de un deploy y el action ID viejo ya no existe): eso NO lo
//  cubre el catch de la Server Action — rechaza acá, en el cliente. Se atrapa
//  y se conserva el último resumen bueno; el poll sigue intentando. (Auditoría
//  19-08: sin el catch era una unhandled rejection cada 45 s y franja muerta.)
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { notificar } from "@/lib/ui/toast";
import { conTimeout } from "@/lib/timeout";
import { getResumenPedidosVivos } from "@/lib/acciones/pedidosVivos";
import {
  pedidosNuevos,
  lineaPedido,
  tituloFranja,
  type ResumenPedidosVivos,
} from "@/lib/avisosPedidos";

const CADA_MS = 45_000;
const DEBOUNCE_REALTIME_MS = 700;
const THROTTLE_REFRESH_MS = 1500;

// ⚠️ AudioContext ÚNICO, creado y "resumido" DENTRO de un gesto del usuario:
// iOS Safari/PWA arranca los contextos creados fuera del gesto en 'suspended'
// y el timbre corría contra un contexto mudo sin tirar error. Se desbloquea en
// el primer toque y se reusa (nunca se cierra).
let audioCtx: AudioContext | null = null;
function desbloquearAudio(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audioCtx) audioCtx = new Ctx();
    void audioCtx?.resume();
  } catch {
    /* sin audio en este navegador */
  }
}

export function AvisoPedidosVivo({ inicial }: { inicial: ResumenPedidosVivos }) {
  const router = useRouter();
  const pathname = usePathname();
  const enPedidos = pathname?.startsWith("/admin/renovaciones") ?? false;
  const enPedidosRef = useRef(enPedidos);
  useEffect(() => {
    enPedidosRef.current = enPedidos;
  }, [enPedidos]);

  const [resumen, setResumen] = useState<ResumenPedidosVivos>(inicial);
  const [ahora, setAhora] = useState(() => Date.now());
  // Lo que ya se vio al montar NO es nuevo: no se le avisa dos veces por lo
  // mismo. Se siembra con TODOS los ids pendientes (no solo los 5 visibles):
  // si no, al resolverse uno, el 6.º —un pedido viejo— entraba a la ventana y
  // sonaba como "🔔 Nuevo pedido" (auditoría 19-08).
  const conocidos = useRef<Set<string>>(new Set(inicial.ids ?? inicial.items.map((p) => p.id)));
  // Huella de la COLA (ids ordenados), no solo el total: si un pedido entra y
  // otro se resuelve en la misma ventana, el total no cambia pero la lista de
  // /admin/renovaciones SÍ — comparar totales dejaba esa pantalla vieja justo
  // donde se aprueba (auditoría 21-08).
  const huellaDe = (r: ResumenPedidosVivos) => (r.ids ?? r.items.map((p) => p.id)).join(",");
  const huellaRef = useRef(huellaDe(inicial));
  const ultimoRefresh = useRef(0);
  const refreshPendiente = useRef<number | null>(null);
  const leyendo = useRef(false);
  // Fallos de TRANSPORTE seguidos (offline o build viejo tras un deploy). Tras
  // varios, si hay red y la pestaña está a la vista, la única cura real para el
  // action ID muerto es recargar la página — una vez, no en loop.
  const fallosSeguidos = useRef(0);
  const yaRecargo = useRef(false);

  // Primer gesto del usuario: desbloquea el timbre (política de autoplay).
  useEffect(() => {
    window.addEventListener("pointerdown", desbloquearAudio, { once: true, passive: true });
    window.addEventListener("keydown", desbloquearAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", desbloquearAudio);
      window.removeEventListener("keydown", desbloquearAudio);
      if (refreshPendiente.current) window.clearTimeout(refreshPendiente.current);
    };
  }, []);

  const avisarNuevos = useCallback((r: ResumenPedidosVivos) => {
    // ⚠️ En SEGUNDO PLANO no se "gasta" el aviso: el toast moriría invisible y
    // el timbre no suena. NO se aprenden los ids — al volver a la pestaña, el
    // refetch de visibilitychange los re-detecta como nuevos y AHÍ se avisa
    // (auditoría 21-08: el caso normal del escritorio es el panel detrás).
    if (document.visibilityState !== "visible") return;
    const nuevos = pedidosNuevos(conocidos.current, r);
    for (const id of r.ids ?? []) conocidos.current.add(id);
    for (const p of r.items) conocidos.current.add(p.id);
    if (nuevos.length === 0) return;
    const t = Date.now();
    // Hasta 3 toasts; si entraron más de golpe, el resto lo dice la franja.
    for (const p of nuevos.slice(0, 3)) {
      notificar({
        tipo: "info",
        titulo: p.tipo === "venta" ? "🔔 Nuevo pedido de venta" : "🔔 Nuevo pedido de renovación",
        mensaje: lineaPedido(p, t),
        href: enPedidosRef.current ? undefined : "/admin/renovaciones",
        duracion: 12_000,
      });
    }
    try {
      navigator.vibrate?.([120, 60, 160]);
    } catch {
      /* sin vibración en este dispositivo */
    }
    timbre();
  }, []);

  const refrescar = useCallback(async () => {
    if (leyendo.current) return;
    leyendo.current = true;
    try {
      let r: ResumenPedidosVivos | null = null;
      try {
        // El timeout evita además que `leyendo` quede tomado por un fetch colgado.
        r = await conTimeout(getResumenPedidosVivos(), 15_000, "pedidosVivos");
      } catch {
        // Transporte caído: sin red, o el panel quedó abierto A TRAVÉS de un
        // deploy y el action ID viejo no existe más — ese caso no se cura solo.
        // Tras ~4 fallos seguidos (≥3 min de franja muerta), con red y pestaña
        // a la vista, se recarga UNA vez: build nuevo, action IDs nuevos.
        fallosSeguidos.current++;
        if (
          fallosSeguidos.current >= 4 &&
          !yaRecargo.current &&
          navigator.onLine &&
          document.visibilityState === "visible"
        ) {
          yaRecargo.current = true;
          window.location.reload();
        }
        return; // queda lo último bueno
      }
      fallosSeguidos.current = 0;
      if (!r) return; // sesión vencida: idem
      setResumen(r);
      setAhora(Date.now());
      avisarNuevos(r);
      // Cambió la COLA (por huella de ids, no solo el total: 1 entra + 1 sale
      // deja el total igual): que el resto del panel (contador del tab, tarjeta
      // de Mi jornada, lista de Pedidos) se entere. ⚠️ La huella se actualiza
      // SOLO cuando el refresh de verdad corre: si el throttle bloquea se
      // PROGRAMA el sobrante — descartarlo dejaba el tab con otro número que la
      // franja para siempre (auditoría 19-08).
      const huella = huellaDe(r);
      if (huella !== huellaRef.current) {
        const t = Date.now();
        const resto = THROTTLE_REFRESH_MS - (t - ultimoRefresh.current);
        if (resto <= 0) {
          huellaRef.current = huella;
          ultimoRefresh.current = t;
          router.refresh();
        } else if (refreshPendiente.current === null) {
          refreshPendiente.current = window.setTimeout(() => {
            refreshPendiente.current = null;
            // Si justo hay una lectura en vuelo, se reintenta enseguida en vez
            // de tragarse el turno (el refresh pendiente es la razón de ser).
            if (leyendo.current) {
              refreshPendiente.current = window.setTimeout(() => {
                refreshPendiente.current = null;
                void refrescar();
              }, 400);
              return;
            }
            void refrescar();
          }, resto + 50);
        }
      }
    } finally {
      leyendo.current = false;
    }
  }, [avisarNuevos, router]);

  // La prop `inicial` fresca de cada server render NO pisa el estado (misma
  // instancia), pero si su CONTENIDO cambió dispara una reconciliación contra
  // el server: sin esto, la franja podía quedar más vieja que lo que el server
  // acababa de renderizar. Se cuelga de la HUELLA (string), no del objeto: cada
  // router.refresh crea un objeto nuevo con el mismo contenido y dispararía
  // llamadas de más. No loopea: huella igual → refrescar() no refresca nada.
  const huellaInicial = huellaDe(inicial);
  useEffect(() => {
    void refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huellaInicial]);

  // 1) Realtime: cualquier cambio en la tabla → relectura (debounce corto).
  useEffect(() => {
    const supabase = createSupabaseBrowser();
    let timer: number | null = null;
    const programar = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refrescar(), DEBOUNCE_REALTIME_MS);
    };
    const canal = supabase
      .channel("avisos-pedidos-calle")
      .on("postgres_changes", { event: "*", schema: "public", table: "solicitudes_renovacion" }, programar)
      .subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, [refrescar]);

  // 2) Al volver a la app + 3) cada 45 s.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refrescar();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const id = window.setInterval(() => {
      setAhora(Date.now());
      if (document.visibilityState === "visible") void refrescar();
    }, CADA_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(id);
    };
  }, [refrescar]);

  if (resumen.total <= 0 || enPedidos) return null;
  const masNuevo = resumen.items[0];

  return (
    <Link
      href="/admin/renovaciones"
      className="panel-azul-vivo print:hidden flex items-center gap-3 border-b px-4 py-2.5 text-left"
    >
      <span aria-hidden="true" className="campana-viva text-[22px] leading-none">
        🔔
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-extrabold leading-tight" style={{ color: "var(--franja-titulo)" }}>
          {tituloFranja(resumen, ahora)}
        </span>
        {masNuevo && (
          <span className="truncate text-[12px] font-semibold text-tinta">
            {lineaPedido(masNuevo, ahora)}
            {resumen.total > 1 ? ` · y ${resumen.total - 1} más` : ""}
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-full bg-[#1E47C8] px-3.5 py-2 text-[12.5px] font-extrabold text-white">
        Aprobar →
      </span>
    </Link>
  );
}

/** Timbre corto de dos notas (WebAudio, sin archivos). Usa el contexto único
 *  desbloqueado en el gesto; si no existe (nunca hubo toque) no suena. */
function timbre(): void {
  try {
    if (!audioCtx) return;
    if (audioCtx.state !== "running") void audioCtx.resume();
    const ctx = audioCtx;
    const nota = (freq: number, t0: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    };
    const t = ctx.currentTime;
    nota(880, t, 0.16);
    nota(1174.66, t + 0.18, 0.22);
  } catch {
    /* sin audio */
  }
}

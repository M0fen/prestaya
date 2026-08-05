"use client";
// ─────────────────────────────────────────────────────────────────────────
//  ARRANQUE DÍA 1 — la tarjeta que SÍ O SÍ ve todo el equipo del piloto
//  hasta completar dos pasos (decisión de Carlos, 08-05):
//   1. CAMBIAR la contraseña provisoria por una propia (se sella en la base:
//      la tarjeta insiste en cualquier teléfono hasta que lo haga).
//   2. INSTALAR la app en el teléfono:
//      · Android/Chrome → botón real de instalar (beforeinstallprompt).
//      · iPhone/Safari → instrucciones paso a paso (iOS no permite botón).
//      · Si ya la abrió INSTALADA (modo standalone), el paso se marca solo.
//  El paso 2 se recuerda POR TELÉFONO (localStorage): instalar es por equipo.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarMiClave } from "@/lib/acciones/cuenta";

const LS_INSTALADA = "py_app_instalada_v1";

type PromptInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function esIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function estaInstalada(): boolean {
  if (typeof window === "undefined") return false;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || localStorage.getItem(LS_INSTALADA) === "1";
}

export function OnboardingDia1({ claveCambiada }: { claveCambiada: boolean }) {
  const router = useRouter();
  // ── Paso 1: contraseña ──
  const [abrirClave, setAbrirClave] = useState(false);
  const [clave1, setClave1] = useState("");
  const [clave2, setClave2] = useState("");
  const [errClave, setErrClave] = useState<string | null>(null);
  const [claveLista, setClaveLista] = useState(claveCambiada);
  const [pendClave, startClave] = useTransition();

  // ── Paso 2: instalación ──
  const ios = useMemo(esIos, []);
  const [instalada, setInstalada] = useState<boolean | null>(null); // null = evaluando (SSR)
  const [verComoIos, setVerComoIos] = useState(false);
  const [promptInstalar, setPromptInstalar] = useState<PromptInstalar | null>(null);
  useEffect(() => {
    setInstalada(estaInstalada());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptInstalar(e as PromptInstalar);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => {
      localStorage.setItem(LS_INSTALADA, "1");
      setInstalada(true);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const guardarClave = () =>
    startClave(async () => {
      setErrClave(null);
      if (clave1.length < 8) {
        setErrClave("Al menos 8 caracteres.");
        return;
      }
      if (clave1 !== clave2) {
        setErrClave("Las dos claves no coinciden.");
        return;
      }
      try {
        const r = await cambiarMiClave({ nueva: clave1 });
        if (!r.ok) {
          setErrClave(r.error);
          return;
        }
        setClaveLista(true);
        setAbrirClave(false);
        setClave1("");
        setClave2("");
        router.refresh();
      } catch {
        setErrClave("Sin señal: probá de nuevo con conexión.");
      }
    });

  const instalar = async () => {
    if (!promptInstalar) return;
    try {
      await promptInstalar.prompt();
      const eleccion = await promptInstalar.userChoice;
      if (eleccion.outcome === "accepted") {
        localStorage.setItem(LS_INSTALADA, "1");
        setInstalada(true);
      }
    } catch {
      /* canceló: el paso sigue pendiente */
    }
  };

  const marcarInstalada = () => {
    localStorage.setItem(LS_INSTALADA, "1");
    setInstalada(true);
  };

  // Nada pendiente → la tarjeta desaparece (instalada === null en SSR: no
  // parpadear "instalá" antes de saber; el paso 1 sí se muestra al toque).
  const paso2Pendiente = instalada === false;
  if (claveLista && !paso2Pendiente) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border-2 border-[#F2C14E] bg-[#FFFBEE] p-4 shadow-[0_4px_14px_rgba(184,138,20,0.12)]">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-extrabold text-[#7A5B10]">🚀 Antes de arrancar — 2 pasos</span>
        <span className="text-[12px] leading-[1.45] font-medium text-[#9A7B2E]">
          Un minuto y quedás listo para trabajar todos los días.
        </span>
      </div>

      {/* ── PASO 1: contraseña propia ── */}
      <div className={`flex flex-col gap-2 rounded-[14px] border bg-white p-3 ${claveLista ? "border-[#BEEBD5]" : "border-[#F0D9A8]"}`}>
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-black text-white ${claveLista ? "bg-[#1FA971]" : "bg-[#E8A317]"}`}>
            {claveLista ? "✓" : "1"}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13.5px] font-extrabold text-tinta">
              {claveLista ? "Contraseña propia ✓" : "Poné tu contraseña propia"}
            </span>
            {!claveLista && (
              <span className="text-[11.5px] font-medium text-gris">
                La que te dieron es provisoria y la conoce más gente. Cambiala ya.
              </span>
            )}
          </div>
          {!claveLista && !abrirClave && (
            <button
              type="button"
              onClick={() => setAbrirClave(true)}
              className="flex-shrink-0 rounded-full bg-[#1E47C8] px-3.5 py-2 text-[12.5px] font-extrabold text-white active:scale-95"
            >
              Cambiar
            </button>
          )}
        </div>
        {!claveLista && abrirClave && (
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={clave1}
              onChange={(e) => setClave1(e.target.value)}
              placeholder="Tu clave nueva (mín. 8)"
              autoComplete="new-password"
              className="min-h-11 rounded-[10px] border border-[#DCE3F4] px-3 text-[16px] outline-none focus:border-azul"
            />
            <input
              type="password"
              value={clave2}
              onChange={(e) => setClave2(e.target.value)}
              placeholder="Repetila"
              autoComplete="new-password"
              className="min-h-11 rounded-[10px] border border-[#DCE3F4] px-3 text-[16px] outline-none focus:border-azul"
            />
            {errClave && <span className="text-[11.5px] font-bold text-[#C0392B]">{errClave}</span>}
            <button
              type="button"
              disabled={pendClave}
              onClick={guardarClave}
              className="min-h-11 rounded-full bg-[#1FA971] px-4 text-[13.5px] font-extrabold text-white disabled:opacity-60"
            >
              {pendClave ? "Guardando…" : "Guardar mi clave"}
            </button>
            <span className="text-[10.5px] font-medium text-gris">
              Desde ahora entrás con esta. Si la olvidás, la oficina te la restablece.
            </span>
          </div>
        )}
      </div>

      {/* ── PASO 2: instalar la app ── */}
      {instalada !== true && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#F0D9A8] bg-white p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E8A317] text-[15px] font-black text-white">
              2
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13.5px] font-extrabold text-tinta">Agregá la app a tu teléfono</span>
              <span className="text-[11.5px] font-medium text-gris">
                Abre al toque desde el ícono y funciona aunque te quedes sin señal.
              </span>
            </div>
            {!ios && promptInstalar && (
              <button
                type="button"
                onClick={instalar}
                className="flex-shrink-0 rounded-full bg-[#1E47C8] px-3.5 py-2 text-[12.5px] font-extrabold text-white active:scale-95"
              >
                Instalar
              </button>
            )}
          </div>

          {(ios || verComoIos || !promptInstalar) && instalada === false && (
            <ol className="flex flex-col gap-1.5 rounded-[11px] bg-[#F6F8FD] p-3 text-[12.5px] leading-[1.5] font-medium text-[#3A445F]">
              {ios || verComoIos ? (
                <>
                  <li>1. Tocá el botón <b>Compartir</b> {" "}<span aria-hidden>⬆️</span> (abajo en Safari).</li>
                  <li>2. Bajá y elegí <b>“Agregar a pantalla de inicio”</b>.</li>
                  <li>3. Tocá <b>Agregar</b> — listo, te queda el ícono de Presta Ya.</li>
                </>
              ) : (
                <>
                  <li>1. Tocá el menú <b>⋮</b> del navegador (arriba a la derecha).</li>
                  <li>2. Elegí <b>“Agregar a la pantalla principal”</b> o <b>“Instalar app”</b>.</li>
                  <li>3. Confirmá — te queda el ícono de Presta Ya.</li>
                </>
              )}
            </ol>
          )}

          <div className="flex items-center justify-between gap-2">
            {!ios && !verComoIos ? (
              <button
                type="button"
                onClick={() => setVerComoIos(true)}
                className="px-1 text-[11px] font-semibold text-gris underline decoration-dotted underline-offset-2"
              >
                ¿Tenés iPhone?
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={marcarInstalada}
              className="rounded-full border border-[#DCE3F4] bg-white px-3.5 py-2 text-[12px] font-bold text-gris active:scale-95"
            >
              Ya la instalé ✓
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

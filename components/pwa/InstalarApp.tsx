"use client";
// Banner discreto para INSTALAR la app en el teléfono. Dos caminos:
//   · Android/Chrome/desktop → capturamos `beforeinstallprompt` y ofrecemos un
//     botón "Instalar" que dispara el diálogo nativo.
//   · iPhone/iPad (Safari)   → no existe ese evento; mostramos la instrucción
//     "Compartir → Agregar a inicio".
// Se oculta si ya está instalada (standalone) o si el usuario lo descartó.
import { useEffect, useState } from "react";

type PromptInstalacion = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const CLAVE_DESCARTE = "py_pwa_descartado";

export function InstalarApp() {
  const [prompt, setPrompt] = useState<PromptInstalacion | null>(null);
  const [esIOS, setEsIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Ya instalada (abierta como app): nunca mostrar.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // Safari iOS expone navigator.standalone.
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    if (localStorage.getItem(CLAVE_DESCARTE) === "1") return;

    const ua = window.navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua); // Safari iOS
    setEsIOS(ios);

    const onBIP = (e: Event) => {
      e.preventDefault(); // evitamos el mini-infobar automático
      setPrompt(e as PromptInstalacion);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // En iOS no hay evento: mostramos la ayuda tras un instante (si no está instalada).
    const t = ios ? window.setTimeout(() => setVisible(true), 2500) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      if (t) clearTimeout(t);
    };
  }, []);

  const descartar = () => {
    setVisible(false);
    try {
      localStorage.setItem(CLAVE_DESCARTE, "1");
    } catch {
      /* noop */
    }
  };

  const instalar = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    setVisible(false);
    if (outcome === "accepted") descartar(); // no volver a ofrecer
  };

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(76px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-[18px] border border-[#DCE3F4] bg-white p-3 shadow-[0_16px_34px_rgba(19,48,140,0.18)]">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(150deg,#2453DC,#13308C)] text-[22px] font-black text-white">
          P
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-[#0F1B3D]">Instalá Presta Ya</p>
          {esIOS ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[12px] leading-[1.4] font-medium text-[#6B7494]">
              Tocá
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="inline-block h-[15px] w-[15px] align-[-2px] text-[#2453DC]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15V3m0 0L8 7m4-4l4 4" />
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
              </svg>
              <b>Compartir</b> y luego <b>Agregar a inicio</b>.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-[1.4] font-medium text-[#6B7494]">
              Guardala en tu teléfono y abrila con un toque.
            </p>
          )}
        </div>
        {!esIOS && (
          <button
            onClick={instalar}
            className="flex-shrink-0 rounded-full bg-[linear-gradient(90deg,#2453DC,#1E47C8)] px-4 py-2 text-[13px] font-bold text-white active:translate-y-px"
          >
            Instalar
          </button>
        )}
        <button
          onClick={descartar}
          aria-label="Cerrar"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[18px] text-[#9AA3BC] hover:bg-[#F4F6FB]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

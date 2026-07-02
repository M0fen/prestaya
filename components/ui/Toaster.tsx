"use client";
// Pila de toasts (avisos flotantes). Escucha el evento `py:toast` y los apila
// abajo a la derecha (arriba en mobile). Auto-cierran; se pueden tocar para ir
// a una ruta (ej. "Nuevo mensaje" → /admin/chat). Respeta prefers-reduced-motion.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { EVENTO_TOAST, type Toast } from "@/lib/ui/toast";

const ESTILO: Record<
  Toast["tipo"],
  { barra: string; icono: string }
> = {
  info: { barra: "#2453DC", icono: "ℹ️" },
  exito: { barra: "#1FA971", icono: "✅" },
  alerta: { barra: "#E8A317", icono: "⚠️" },
  error: { barra: "#D64545", icono: "⛔" },
};

const MAX_VISIBLES = 4;

export function Toaster() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const cerrar = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      if (!t?.id) return;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLES - 1)), t]);
      if (t.duracion && t.duracion > 0) {
        window.setTimeout(() => cerrar(t.id), t.duracion);
      }
    };
    window.addEventListener(EVENTO_TOAST, onToast);
    return () => window.removeEventListener(EVENTO_TOAST, onToast);
  }, [cerrar]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:items-end">
      {toasts.map((t) => {
        const est = ESTILO[t.tipo];
        const clickable = Boolean(t.href);
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => {
              if (t.href) {
                router.push(t.href);
                cerrar(t.id);
              }
            }}
            className={`toast-in pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 overflow-hidden rounded-[14px] border border-[#E6EAF4] bg-white p-3 pl-3.5 shadow-[0_12px_30px_rgba(19,48,140,0.16)] ${
              clickable ? "cursor-pointer hover:border-[#DCE3F4]" : ""
            }`}
            style={{ borderLeft: `4px solid ${est.barra}` }}
          >
            <span aria-hidden="true" className="mt-px text-[16px] leading-none">
              {est.icono}
            </span>
            <div className="min-w-0 flex-1">
              {t.titulo && (
                <p className="text-[13px] font-extrabold text-[#0F1B3D]">{t.titulo}</p>
              )}
              <p className="text-[12.5px] leading-[1.4] font-medium text-[#6B7494]">
                {t.mensaje}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                cerrar(t.id);
              }}
              aria-label="Cerrar aviso"
              className="-mt-0.5 -mr-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[15px] text-[#9AA3BC] hover:bg-[#F4F6FB]"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

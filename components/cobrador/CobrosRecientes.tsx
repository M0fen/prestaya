"use client";
// Cobros recientes con "DESHACER" dentro de 1 hora. Money-safe: deshacer NO borra
// el libro — llama a deshacerPagoAction, que marca el pago anulado (con traza).
// Solo aparece el botón para los cobros que registró ESTE usuario y mientras no
// pase 1 h; pasada la ventana, hay que ir por la anulación normal.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deshacerPagoAction } from "@/lib/acciones/anulaciones";
import { UYU } from "@/lib/format";

const VENTANA_MS = 60 * 60 * 1000; // 1 hora

export type PagoReciente = {
  id: string;
  monto: number;
  /** ISO de registrado_en. */
  registradoEn: string;
  /** Lo registró el usuario actual (puede deshacerlo). */
  esMio: boolean;
};

export function CobrosRecientes({ pagos }: { pagos: PagoReciente[] }) {
  const router = useRouter();
  const [ahora, setAhora] = useState<number>(() => Date.now());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Deshechos de forma OPTIMISTA: se marcan "Deshecho ✓" al instante y el servidor
  // + el refresco de la página sincronizan por detrás. Antes el botón quedaba
  // "Deshaciendo…" hasta que TODO el round-trip + re-fetch terminaba (se sentía lento).
  const [deshechos, setDeshechos] = useState<Set<string>>(new Set());

  // Tick para refrescar la cuenta regresiva de la ventana de 1 h.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  if (pagos.length === 0) return null;

  const deshacer = (id: string) => {
    setError(null);
    // Deshacer necesita RED (server action). La ficha se sirve cacheada offline, así
    // que sin señal hay que avisar y NO marcar optimista (evita que el await reviente
    // la pantalla con un fetch-failed).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("Necesitás señal para deshacer un cobro.");
      return;
    }
    setDeshechos((s) => new Set(s).add(id)); // efecto inmediato en la UI
    startTransition(async () => {
      try {
        const r = await deshacerPagoAction({ pagoId: id });
        if (!r.ok) {
          // Falló: revertir el optimismo y avisar.
          setDeshechos((s) => { const n = new Set(s); n.delete(id); return n; });
          setError(r.error);
        } else {
          router.refresh(); // el pago ya quedó anulado; el cartón se actualiza por detrás
        }
      } catch {
        // La red se cayó a mitad del round-trip: revertir y avisar INLINE (no dejar que
        // el error escape del transition y tire el error boundary del cobrador).
        setDeshechos((s) => { const n = new Set(s); n.delete(id); return n; });
        setError("No pudimos deshacer (sin señal). Probá de nuevo con conexión.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-tarjeta p-3.5 shadow-sm">
      <span className="text-[11.5px] font-bold text-gris">Cobros recientes</span>
      <ul className="flex flex-col gap-1.5">
        {pagos.map((p) => {
          const restanteMs = VENTANA_MS - (ahora - new Date(p.registradoEn).getTime());
          const puede = p.esMio && restanteMs > 0;
          const min = Math.max(1, Math.ceil(restanteMs / 60000));
          return (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-bold text-tinta tabular-nums">{UYU(p.monto)}</span>
              {deshechos.has(p.id) ? (
                <span className="text-[11px] font-bold text-verde-osc">Deshecho ✓</span>
              ) : puede ? (
                <button
                  type="button"
                  onClick={() => deshacer(p.id)}
                  className="rounded-full border border-rojo-suave bg-rojo-suave px-3 py-1.5 text-[12px] font-bold text-rojo-osc active:scale-95"
                >
                  Deshacer · {min} min
                </button>
              ) : (
                <span className="text-[11px] font-medium text-gris">
                  {p.esMio ? "Ventana vencida" : "Cobrado"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-[11.5px] font-semibold text-rojo-osc">{error}</p>}
    </div>
  );
}

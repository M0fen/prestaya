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
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Tick para refrescar la cuenta regresiva de la ventana de 1 h.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  if (pagos.length === 0) return null;

  const deshacer = (id: string) => {
    setError(null);
    startTransition(async () => {
      const r = await deshacerPagoAction({ pagoId: id });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11.5px] font-bold text-gris">Cobros recientes</span>
      <ul className="flex flex-col gap-1.5">
        {pagos.map((p) => {
          const restanteMs = VENTANA_MS - (ahora - new Date(p.registradoEn).getTime());
          const puede = p.esMio && restanteMs > 0;
          const min = Math.max(1, Math.ceil(restanteMs / 60000));
          return (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-bold text-tinta tabular-nums">{UYU(p.monto)}</span>
              {puede ? (
                <button
                  type="button"
                  onClick={() => deshacer(p.id)}
                  disabled={pendiente}
                  className="rounded-full border border-[#F3C0B8] bg-[#FBE4E2] px-3 py-1.5 text-[12px] font-bold text-[#C0392B] active:scale-95 disabled:opacity-50"
                >
                  {pendiente ? "Deshaciendo…" : `Deshacer · ${min} min`}
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
      {error && <p className="text-[11.5px] font-semibold text-[#C0392B]">{error}</p>}
    </div>
  );
}

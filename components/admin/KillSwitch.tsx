"use client";
// Kill switch de emergencia: congela/descongela las escrituras de plata (pagos,
// pago de panel, cierre de jornada) SIN redeploy. Prender requiere confirmación
// (frena la operación); apagar es directo (vuelve a la normalidad).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setModoSoloLectura } from "@/lib/acciones/featureFlags";

export function KillSwitch({ activo }: { activo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const cambiar = (v: boolean) =>
    start(async () => {
      setError(null);
      const r = await setModoSoloLectura(v);
      if (!r.ok) setError(r.error);
      else {
        setConfirmar(false);
        router.refresh();
      }
    });

  return (
    <section
      className="rounded-[16px] border p-4"
      style={{
        borderColor: activo ? "#F3C0B8" : "#E6EAF4",
        background: activo ? "#FEF6F3" : "#fff",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">
            {activo ? "⛔ Modo solo lectura ACTIVO" : "🟢 Operación normal"}
          </span>
          <span className="text-[12px] font-medium text-gris">
            {activo
              ? "Las escrituras de plata (cobros, pago de panel, cierre) están CONGELADAS. Nadie puede registrar dinero hasta que lo desactives."
              : "Congela al instante todas las escrituras de dinero si detectás una corrupción, sin esperar un deploy. Se descongela desde acá."}
          </span>
        </div>
      </div>

      {error && <p className="mt-2 text-[12px] font-bold text-[#C0392B]">{error}</p>}

      {activo ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => cambiar(false)}
          className="mt-3 rounded-[12px] bg-[#1FA971] px-4 py-2.5 text-[13.5px] font-extrabold text-white disabled:opacity-60"
        >
          {pending ? "Reactivando…" : "Reactivar la operación"}
        </button>
      ) : !confirmar ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmar(true)}
          className="mt-3 rounded-[12px] border border-[#D6A79E] px-4 py-2.5 text-[13.5px] font-bold text-[#C0392B] disabled:opacity-60"
        >
          Congelar escrituras de plata
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2 rounded-[12px] bg-[#FBE4E2] p-3">
          <span className="text-[12.5px] font-bold text-[#C0392B]">
            Vas a frenar TODOS los cobros del sistema. Solo hacelo ante una corrupción de datos.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmar(false)}
              className="flex-1 rounded-[10px] border border-[#DCE3F4] py-2 text-[13px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => cambiar(true)}
              className="flex-1 rounded-[10px] bg-[#C0392B] py-2 text-[13px] font-extrabold text-white disabled:opacity-60"
            >
              {pending ? "Congelando…" : "Sí, congelar"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

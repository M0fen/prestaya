"use client";
// ─────────────────────────────────────────────────────────────────────────
//  "Este cliente no va a usar la app" (0131).
//
//  Verificado en la base: 55 clientes de Zona Centro tienen teléfono FIJO —
//  no van a poder escanear el QR ni recibir el WhatsApp. Sin esta salida
//  quedaban "pendientes" para siempre: el cobrador reintentaba en cada visita
//  y el avance de la campaña nunca podía llegar al 100%.
//
//  NO es dar de baja: el cliente sigue en la ruta y se le cobra igual. Y es
//  reversible de un toque, por si consigue un teléfono.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarAppNoAplicaAction, MOTIVOS_NO_APP } from "@/lib/acciones/acceso";

export function NoUsaApp({
  clienteId,
  marcado,
  motivo,
}: {
  clienteId: string;
  marcado: boolean;
  motivo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  const guardar = (m: string | null, activar: boolean) =>
    start(async () => {
      setError(null);
      const r = await marcarAppNoAplicaAction({ clienteId, motivo: m, activar });
      if (r.ok) {
        setAbierto(false);
        router.refresh();
      } else setError(r.error);
    });

  if (marcado) {
    return (
      <div className="flex flex-col gap-2 rounded-[14px] bg-[#F3F5FB] px-4 py-3">
        <span className="text-[12.5px] font-bold text-gris">
          ○ Este cliente no usa la app{motivo ? ` · ${motivo}` : ""}
        </span>
        <span className="text-[11.5px] leading-[1.45] font-medium text-tenue-2">
          No aparece más como pendiente. Le seguís cobrando normal.
        </span>
        <button
          type="button"
          onClick={() => guardar(null, false)}
          disabled={pendiente}
          className="min-h-11 self-start rounded-full px-3 text-[12px] font-bold text-azul underline decoration-dotted underline-offset-4 disabled:opacity-50"
        >
          {pendiente ? "…" : "Consiguió teléfono · volver a intentar"}
        </button>
        {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mx-auto min-h-11 rounded-full px-3 text-[12px] font-bold text-gris underline decoration-dotted underline-offset-4 active:text-azul"
      >
        Este cliente no puede usar la app
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-[#DCE3F4] bg-white p-3.5">
      <span className="text-[12.5px] font-bold text-tinta">¿Por qué no la va a usar?</span>
      <div className="flex flex-wrap gap-2">
        {MOTIVOS_NO_APP.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pendiente}
            onClick={() => guardar(m, true)}
            className="min-h-11 rounded-full bg-[#F4F6FB] px-3.5 text-[12.5px] font-bold text-tinta active:scale-95 disabled:opacity-50"
          >
            {m}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="min-h-11 self-start px-1 text-[12px] font-bold text-gris"
      >
        Cancelar
      </button>
      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}

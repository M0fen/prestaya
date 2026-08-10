"use client";
// ─────────────────────────────────────────────────────────────────────────
//  LA SALIDA. Patrón único para los callejones sin salida de la app del
//  cobrador: cobro mal tipeado pasada la ventana de deshacer, cliente sin
//  crédito, crédito que ya no está activo, error al cerrar la jornada.
//
//  En todos esos casos el cobrador está PARADO EN LA PUERTA del cliente,
//  muchas veces con plata en la mano, y hasta ahora la app le decía qué pasó
//  pero no qué hacer. Deja una NOTA en la ficha del cliente (que el supervisor
//  y la oficina ven) con el texto ya escrito: un toque y sabe que quedó
//  registrado. No resuelve el problema solo — pero lo saca del limbo y deja
//  rastro, que es lo que hoy falta.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { agregarNotaCliente } from "@/lib/acciones/notas";

export function PedirAyuda({
  clienteId,
  etiqueta,
  textoSugerido,
  tono = "neutro",
}: {
  clienteId: string;
  /** Texto del botón, en la voz del cobrador ("Está mal, avisar"). */
  etiqueta: string;
  /** Nota ya redactada: el cobrador solo confirma (o la edita si quiere). */
  textoSugerido: string;
  tono?: "neutro" | "alerta";
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(textoSugerido);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  if (enviado) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E4F5EC] px-3 py-2 text-[12px] font-bold text-[#157A50]">
        ✓ Avisado — queda anotado en la ficha del cliente
      </span>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`min-h-11 rounded-full px-4 text-[12.5px] font-bold ${
          tono === "alerta" ? "bg-[#FBE4E2] text-[#C0392B]" : "bg-[#EEF3FF] text-[#1E47C8]"
        }`}
      >
        {etiqueta}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-[12px] bg-[#F4F6FB] p-3">
      <span className="text-[11.5px] font-bold text-gris">
        Esto le va a llegar a tu supervisor y a la oficina:
      </span>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        className="w-full rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[16px] leading-[1.4] text-tinta"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pendiente || texto.trim().length < 3}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const r = await agregarNotaCliente({ clienteId, cuerpo: texto.trim() });
                if (r.ok) setEnviado(true);
                else setError(r.error);
              } catch {
                // ⚠️ SIN ESTE catch, la Server Action que falla por falta de señal
                // escapaba del transition y tiraba el error boundary: se reemplazaba
                // TODA la pantalla por "Fue algo temporal… Probá de nuevo" y el
                // cobrador perdía lo que había tipeado — y la pantalla donde estaba
                // (el cobro mal cargado, el cierre a medio contar). Sus cinco
                // componentes hermanos ya tenían el catch; justo la SALIDA DE
                // EMERGENCIA no. Y como la ficha se abre sin señal a propósito
                // (está precargada), llegar acá offline es lo normal.
                //
                // El catch NO hace que el aviso salga: sin señal no sale nada. Lo
                // que gana es no perder el texto, no perder la pantalla, y decir la
                // verdad en vez de "probá de nuevo" —que offline va a fallar igual.
                setError(
                  "Sin señal: el aviso no salió. Tu texto sigue acá — tocá “Enviar aviso” de nuevo cuando tengas datos.",
                );
              }
            })
          }
          className="min-h-11 flex-1 rounded-full bg-[#1E47C8] px-4 text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {pendiente ? "Enviando…" : "Enviar aviso"}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-11 rounded-full px-3 text-[12.5px] font-bold text-gris"
        >
          Cancelar
        </button>
      </div>
      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}

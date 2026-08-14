"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Entrega del link del cartón: WhatsApp / compartir / copiar.
//
//  Detalle que importa en la calle: WhatsApp y el compartir nativo se abren
//  SINCRÓNICAMENTE dentro del toque (si se abren después de un `await`, el
//  navegador los bloquea como popup). El registro de la entrega va después,
//  en segundo plano: si falla, el link ya se compartió igual.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { linkWhatsApp } from "@/lib/telefono";
import { textoInvitacion } from "@/lib/invitacion";
import { marcarAccesoEntregadoAction } from "@/lib/acciones/acceso";

export function AccionesAcceso({
  clienteId,
  nombre,
  telefono,
  url,
  entregado,
}: {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  url: string;
  entregado: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const [marcado, setMarcado] = useState(entregado);
  const [, start] = useTransition();

  const mensaje = textoInvitacion(nombre, url);
  const tieneTel = Boolean((telefono ?? "").replace(/\D/g, ""));

  /** Deja constancia de la entrega (optimista: la UI no espera al servidor). */
  function registrarEntrega() {
    if (marcado) return;
    setMarcado(true);
    start(async () => {
      await marcarAccesoEntregadoAction(clienteId);
    });
  }

  function porWhatsApp() {
    window.open(linkWhatsApp(telefono, mensaje), "_blank", "noopener,noreferrer");
    registrarEntrega();
  }

  async function compartir() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Tu cartón de Presta Ya", text: mensaje });
        registrarEntrega();
        return;
      } catch {
        /* si cancela, no pasa nada */
      }
      return;
    }
    copiar();
  }

  function copiar() {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1800);
      },
      () => {},
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={porWhatsApp}
        className="flex items-center justify-center gap-2 rounded-[16px] bg-[#25D366] px-4 py-4 text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(37,211,102,0.32)] active:scale-[0.98]"
      >
        <span aria-hidden="true">💬</span>
        {tieneTel ? "Enviar por WhatsApp" : "Enviar por WhatsApp…"}
      </button>
      {!tieneTel && (
        <p className="-mt-1 text-center text-[11.5px] font-medium text-gris">
          Este cliente no tiene teléfono cargado: WhatsApp te va a pedir el contacto.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={compartir}
          className="flex items-center justify-center gap-1.5 rounded-[12px] border border-campo bg-tarjeta px-3 py-3 text-[13px] font-bold text-azul active:scale-[0.98]"
        >
          <span aria-hidden="true">📤</span> Compartir
        </button>
        <button
          type="button"
          onClick={copiar}
          className="flex items-center justify-center gap-1.5 rounded-[12px] border border-campo bg-tarjeta px-3 py-3 text-[13px] font-bold text-azul active:scale-[0.98]"
        >
          <span aria-hidden="true">🔗</span> {copiado ? "¡Copiado!" : "Copiar link"}
        </button>
      </div>

      {/* Constancia manual: cubre el caso "se lo pasé por otro lado". */}
      {!marcado ? (
        <button
          type="button"
          onClick={registrarEntrega}
          className="mx-auto mt-0.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-gris underline decoration-dotted underline-offset-4 active:text-azul"
        >
          Ya se lo entregué
        </button>
      ) : (
        <p className="mt-0.5 text-center text-[12px] font-bold text-verde-osc">
          ✓ Entrega registrada
        </p>
      )}
    </div>
  );
}

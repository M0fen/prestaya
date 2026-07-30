"use client";
// "¿No podés entrar?" en el login. Cubre el caso crítico del día 1: un cobrador
// trabado (clave olvidada, email que no recuerda) para quien el chat interno NO
// sirve porque justamente no pudo iniciar sesión. Un toque → WhatsApp/llamada a
// la oficina con un mensaje ya escrito. Discreto (colapsado) para no ensuciar el
// login, pero siempre a mano.
import { useState } from "react";
import { enlaceSoporte, SOPORTE_TEL } from "@/lib/soporte";

export function AyudaIngreso() {
  const [abierto, setAbierto] = useState(false);
  const soporte = enlaceSoporte(
    "Hola, soy del equipo de Presta Ya y no puedo entrar a la app. ¿Me ayudan?",
  );

  return (
    <div className="mt-5 flex flex-col items-center gap-2 text-center">
      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="inline-block min-h-11 px-3 py-2 text-[12.5px] font-semibold text-white/70 underline decoration-white/30 decoration-dotted underline-offset-4 active:text-white"
        >
          ¿No podés entrar?
        </button>
      ) : (
        <div className="flex w-full flex-col items-center gap-2 rounded-[14px] border border-white/15 bg-white/5 px-4 py-3.5">
          <p className="text-[12.5px] font-medium text-white/75">
            Escribile a la oficina y te ayudan con tu acceso.
          </p>
          <a
            href={soporte.href}
            target={soporte.esWhatsApp ? "_blank" : undefined}
            rel={soporte.esWhatsApp ? "noopener noreferrer" : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-[13.5px] font-extrabold text-white active:scale-95"
          >
            <span aria-hidden="true">{soporte.esWhatsApp ? "💬" : "📞"}</span>
            {soporte.esWhatsApp ? "Escribir por WhatsApp" : `Llamar a la oficina · ${SOPORTE_TEL}`}
          </a>
        </div>
      )}
    </div>
  );
}

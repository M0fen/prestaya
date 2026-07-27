"use client";
// Restablecer el acceso de un miembro del equipo, desde su ficha.
// Flujo: confirmar → generar clave nueva → mostrarla UNA vez con copiar +
// enviar por WhatsApp al interesado. La autorización real es server-side
// (restablecerAccesoAction); acá solo se muestra cuando corresponde.
import { useState, useTransition } from "react";
import { restablecerAccesoAction } from "@/lib/acciones/equipo";
import { linkWhatsApp } from "@/lib/telefono";

export function RestablecerAcceso({
  usuarioId,
  nombre,
  telefono,
}: {
  usuarioId: string;
  nombre: string;
  telefono: string | null;
}) {
  const [pending, start] = useTransition();
  const [clave, setClave] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  function restablecer() {
    if (!confirm(`¿Generar una contraseña nueva para ${nombre}? La anterior deja de funcionar.`))
      return;
    setError(null);
    start(async () => {
      const r = await restablecerAccesoAction(usuarioId);
      if (r.ok) setClave(r.password);
      else setError(r.error);
    });
  }

  function copiar() {
    if (!clave) return;
    navigator.clipboard?.writeText(clave).then(
      () => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1800);
      },
      () => {},
    );
  }

  if (clave) {
    const msg = `Hola ${nombre.split(/\s+/)[0]}, tu acceso a Presta Ya se restableció.\nTu nueva contraseña es: ${clave}\nEntrá con tu email y esta clave. ¡Guardala!`;
    return (
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#CDE9D8] bg-[#EAF6EE] p-3.5">
        <span className="text-[12px] font-bold text-[#157A50]">
          ✓ Acceso restablecido. Pasale esta contraseña a {nombre.split(/\s+/)[0]}:
        </span>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[10px] border border-[#CDE9D8] bg-white px-3 py-2.5 text-center text-[18px] font-black tracking-wider text-tinta tabular-nums select-all">
            {clave}
          </code>
          <button
            type="button"
            onClick={copiar}
            className="flex-shrink-0 rounded-[10px] bg-[#1FA971] px-3 py-2.5 text-[12px] font-bold text-white active:scale-95"
          >
            {copiado ? "¡Copiado!" : "Copiar"}
          </button>
        </div>
        <a
          href={linkWhatsApp(telefono, msg)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-[11px] bg-[#25D366] px-4 py-2.5 text-[13px] font-extrabold text-white active:scale-95"
        >
          <span aria-hidden="true">💬</span>
          Enviar por WhatsApp{telefono ? "" : "…"}
        </a>
        <p className="text-[10.5px] font-medium text-[#5B7A66]">
          Anotala ahora: por seguridad no se vuelve a mostrar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={restablecer}
        disabled={pending}
        className="rounded-full border border-[#DCE3F1] bg-tarjeta px-4 py-2 text-[13px] font-bold text-azul hover:bg-suave disabled:opacity-40"
      >
        {pending ? "Restableciendo…" : "🔑 Restablecer contraseña"}
      </button>
      {error && <span className="text-[11.5px] font-bold text-[#C0392B]">{error}</span>}
    </div>
  );
}

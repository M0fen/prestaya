"use client";
// Dar de BAJA / REACTIVAR un usuario (solo admin). La baja corta TODO acceso a la
// app y banea el login en Supabase Auth (offboarding real). Confirmación en 2 pasos
// para la baja (acción sensible); reactivar es directo. La autorización real es server-side.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUsuarioActivo } from "@/lib/acciones/usuarios";

export function BajaUsuario({
  usuarioId,
  nombre,
  activo,
}: {
  usuarioId: string;
  nombre: string;
  activo: boolean;
}) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aplicar = (nuevo: boolean) => {
    setError(null);
    start(async () => {
      const r = await setUsuarioActivo({ usuarioId, activo: nuevo });
      if (r.ok) {
        setConfirmar(false);
        router.refresh();
      } else setError(r.error);
    });
  };

  if (!activo) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={pend}
          onClick={() => aplicar(true)}
          className="rounded-[12px] bg-verde-osc px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {pend ? "Reactivando…" : "Reactivar acceso"}
        </button>
        <span className="text-[11.5px] font-medium text-tenue">
          Está dado de baja: no puede entrar. Reactivalo para devolverle el acceso.
        </span>
        {error && <span className="text-[12px] font-bold text-rojo-osc">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {confirmar ? (
        <div className="flex flex-col gap-2 rounded-[12px] bg-rojo-suave p-3">
          <span className="text-[12.5px] font-bold text-rojo-osc">
            Vas a dar de baja a {nombre}. Pierde el acceso al instante y no puede volver a entrar hasta que lo reactives.
          </span>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmar(false)} className="text-[12px] font-bold text-gris hover:underline">
              Cancelar
            </button>
            <button
              type="button"
              disabled={pend}
              onClick={() => aplicar(false)}
              className="rounded-[12px] bg-rojo-osc px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {pend ? "Dando de baja…" : "Sí, dar de baja"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pend}
          onClick={() => setConfirmar(true)}
          className="rounded-[12px] border border-rojo-osc px-4 py-2.5 text-[13px] font-bold text-rojo-osc disabled:opacity-50"
        >
          Dar de baja (offboarding)
        </button>
      )}
      {error && <span className="text-[12px] font-bold text-rojo-osc">{error}</span>}
    </div>
  );
}

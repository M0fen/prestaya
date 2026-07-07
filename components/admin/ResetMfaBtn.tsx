"use client";
// Botón para que un admin resetee el 2FA de otro usuario (recuperación si
// perdió el teléfono). Llama a la Server Action admin-gated + auditada.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetear2FA } from "@/lib/acciones/mfa";

export function ResetMfaBtn({ usuarioId, nombre }: { usuarioId: string; nombre: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`¿Resetear el 2FA de ${nombre}? Va a poder entrar solo con contraseña y volver a activarlo.`))
            return;
          setMsg(null);
          startTransition(async () => {
            const r = await resetear2FA(usuarioId);
            setMsg(r.ok ? "2FA reseteado ✓" : r.error);
            if (r.ok) router.refresh();
          });
        }}
        className="rounded-[9px] border border-[#DCE3F1] px-2.5 py-1 text-[11.5px] font-bold text-[#C0392B] hover:bg-[#FDECEA] disabled:opacity-40"
      >
        Resetear 2FA
      </button>
      {msg && <span className="text-[11px] font-semibold text-gris">{msg}</span>}
    </div>
  );
}

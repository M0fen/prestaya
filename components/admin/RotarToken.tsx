"use client";
// Link de acceso del cliente + botón "Regenerar" (SOLO admin). Al rotar, el
// link anterior deja de servir. Muestra la URL para copiar/compartir.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rotarTokenAction } from "@/lib/acciones/token";

export function RotarToken({ clienteId, token }: { clienteId: string; token: string }) {
  const [actual, setActual] = useState(token);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const url = typeof window !== "undefined" ? `${window.location.origin}/c/${actual}` : `/c/${actual}`;

  function copiar() {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      },
      () => {},
    );
  }

  function regenerar() {
    if (!confirm("¿Regenerar el link? El link anterior dejará de funcionar de inmediato.")) return;
    setError(null);
    startTransition(async () => {
      const r = await rotarTokenAction(clienteId);
      if (r.ok) {
        setActual(r.token);
        // El QR de abajo se arma en el servidor con el token: hay que
        // re-renderizar la página o quedaría mostrando el link viejo.
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-tinta">Link de acceso del cliente</span>
        <button
          type="button"
          disabled={pending}
          onClick={regenerar}
          className="rounded-[9px] border border-[#DCE3F1] px-2.5 py-1 text-[11.5px] font-bold text-azul hover:bg-suave disabled:opacity-40"
        >
          {pending ? "Regenerando…" : "Regenerar link"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[8px] bg-suave px-2.5 py-1.5 text-[11.5px] text-[#4E576F]">
          {url}
        </code>
        <button
          type="button"
          onClick={copiar}
          className="flex-shrink-0 rounded-[8px] bg-azul px-2.5 py-1.5 text-[11.5px] font-bold text-white"
        >
          {copiado ? "¡Copiado!" : "Copiar"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11.5px] font-bold text-[#C0392B]">{error}</p>}
      <p className="mt-2 text-[11px] font-medium text-tenue">
        Compartí este link solo con el cliente. Si se filtra, regeneralo y el anterior deja de servir.
      </p>
    </section>
  );
}

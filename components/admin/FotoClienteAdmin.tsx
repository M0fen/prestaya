"use client";
// Foto del cliente en la ficha (admin): muestra la actual (URL firmada) y permite
// cargar/actualizar. Sube apenas se elige (comprimida en el navegador).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CapturaFoto } from "@/components/CapturaFoto";
import { guardarFotoCliente } from "@/lib/acciones/clientes";

export function FotoClienteAdmin({
  clienteId,
  fotoUrl,
}: {
  clienteId: string;
  fotoUrl: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const subir = (dataUrl: string) => {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await guardarFotoCliente({ clienteId, dataUrl });
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <CapturaFoto fotoUrlInicial={fotoUrl} onDataUrl={subir} etiqueta="Foto del cliente" />
      {pendiente && <span className="text-[11.5px] font-medium text-gris">Guardando foto…</span>}
      {ok && !pendiente && <span className="text-[11.5px] font-semibold text-[#157A50]">✓ Foto guardada.</span>}
      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}

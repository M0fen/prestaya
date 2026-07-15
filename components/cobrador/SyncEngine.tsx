"use client";
// Motor de sincronización visible: corre en el layout del cobrador (persiste
// entre pantallas), vacía la cola offline y refresca la vista al sincronizar.
// Muestra una franja de estado solo cuando hay algo para decir.
import { useRouter } from "next/navigation";
import { useSync } from "@/lib/cobrador/useSync";

export function SyncEngine({ usuarioId }: { usuarioId: string }) {
  const router = useRouter();
  const { pendientes, online, sincronizando } = useSync(usuarioId, () => router.refresh());
  const n = pendientes.length;

  if (online && n === 0 && !sincronizando) return null;

  const { texto, bg } = !online
    ? { texto: `Sin conexión · ${n} en cola`, bg: "#B9770E" }
    : sincronizando
      ? { texto: "Sincronizando…", bg: "#1E47C8" }
      : { texto: `${n} por sincronizar`, bg: "#1E47C8" };

  return (
    <div
      className="px-4 py-1.5 text-center text-[11.5px] font-bold text-white"
      style={{ background: bg }}
      role="status"
    >
      {texto}
    </div>
  );
}

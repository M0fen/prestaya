"use client";
// Motor de sincronización visible: corre en el layout del cobrador (persiste
// entre pantallas), vacía la cola offline y refresca la vista al sincronizar.
// Muestra una franja de estado solo cuando hay algo para decir.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSync } from "@/lib/cobrador/useSync";
import { opAtascada } from "@/lib/cobrador/colaOffline";

export function SyncEngine({ usuarioId }: { usuarioId: string }) {
  const router = useRouter();

  // Pide almacenamiento PERSISTENTE una sola vez: la cola de cobros sin sincronizar
  // vive en localStorage, que el navegador/OS puede DESALOJAR bajo presión de
  // espacio (y iOS Safari purga el storage de una PWA sin uso a los ~7 días). Con
  // persistencia concedida, el desalojo automático se desactiva → un cobro guardado
  // no se evapora del teléfono antes de subir. Best-effort: si no está disponible o
  // se rechaza, no cambia nada (seguimos igual que antes).
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const { pendientes, online, sincronizando } = useSync(usuarioId, () => router.refresh());
  // Solo cuentan las que PUEDEN sincronizar: una op atascada (error permanente) no
  // sube sola → contarla dejaba la franja "por sincronizar" fija y engañosa. Las
  // atascadas se resuelven descartándolas en "Cerrar jornada".
  const sincronizables = pendientes.filter((o) => !opAtascada(o));
  const n = sincronizables.length;
  const atascadas = pendientes.length - n;

  if (online && n === 0 && !sincronizando && atascadas === 0) return null;

  const { texto, bg } = !online
    ? { texto: `Sin conexión · ${n} en cola`, bg: "#B9770E" }
    : sincronizando
      ? { texto: "Sincronizando…", bg: "#1E47C8" }
      : n > 0
        ? { texto: `${n} por sincronizar`, bg: "#1E47C8" }
        : { texto: `${atascadas} sin subir · revisalo en “Cerrar jornada”`, bg: "#B9770E" };

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

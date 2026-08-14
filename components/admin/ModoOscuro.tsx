"use client";
// Interruptor de modo oscuro. Aplica `data-tema` sobre la raíz indicada
// (#panel-root en el admin, #cobrador-root en la app de calle) y persiste en
// cookie para que el SSR lo respete en la próxima carga (sin flash). La cookie
// es UNA por dispositivo: el teléfono del cobrador y el panel comparten la
// preferencia, que es lo que uno espera de "modo oscuro". Sin librería de tema.
import { useState } from "react";

export function ModoOscuro({ inicial, rootId = "panel-root" }: { inicial: boolean; rootId?: string }) {
  const [oscuro, setOscuro] = useState(inicial);

  const alternar = () => {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    const val = nuevo ? "oscuro" : "claro";
    document.getElementById(rootId)?.setAttribute("data-tema", val);
    document.cookie = `tema=${val}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={oscuro}
      title={oscuro ? "Modo claro" : "Modo oscuro"}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-suave text-[15px] hover:opacity-80"
    >
      <span aria-hidden>{oscuro ? "☀️" : "🌙"}</span>
    </button>
  );
}

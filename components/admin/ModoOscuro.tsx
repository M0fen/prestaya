"use client";
// Interruptor de modo oscuro del panel. Aplica `data-tema` sobre #panel-root
// (scopea el tema al admin) y persiste en cookie para que el SSR lo respete en
// la próxima carga (sin flash). No usa librería de tema.
import { useState } from "react";

export function ModoOscuro({ inicial }: { inicial: boolean }) {
  const [oscuro, setOscuro] = useState(inicial);

  const alternar = () => {
    const nuevo = !oscuro;
    setOscuro(nuevo);
    const val = nuevo ? "oscuro" : "claro";
    document.getElementById("panel-root")?.setAttribute("data-tema", val);
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

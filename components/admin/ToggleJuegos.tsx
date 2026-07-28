"use client";
// Interruptor "¿Mostrar los juegos al cliente?" en /admin/promos. Es el mismo
// `activo` de los ajustes, traído acá para que el on/off viva JUNTO a lo que se
// configura (antes había que ir a "Zona de juego", otra pantalla). Optimista:
// refleja el cambio al toque y lo persiste en segundo plano.
import { useState, useTransition } from "react";
import { setJuegosVisiblesAction } from "@/lib/acciones/juego";

export function ToggleJuegos({ inicial }: { inicial: boolean }) {
  const [activo, setActivo] = useState(inicial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function alternar() {
    const nuevo = !activo;
    setActivo(nuevo); // optimista
    setError(null);
    start(async () => {
      const r = await setJuegosVisiblesAction(nuevo);
      if (!r.ok) {
        setActivo(!nuevo); // revertir
        setError(r.error);
      }
    });
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-[16px] border p-4 ${
        activo ? "border-[#CDE9D8] bg-[#EAF6EE]" : "border-borde bg-tarjeta"
      }`}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-[14px] font-extrabold text-tinta">
          {activo ? "Los juegos se ven en el cartón" : "Los juegos están ocultos"}
        </span>
        <span className="text-[12px] font-medium text-gris">
          Prende o apaga la raspadita y la quiniela para todos los clientes.
        </span>
        {error && <span className="mt-1 text-[11.5px] font-bold text-[#C0392B]">{error}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label="Mostrar los juegos al cliente"
        disabled={pending}
        onClick={alternar}
        className="relative h-[30px] w-[54px] flex-shrink-0 rounded-full transition-colors disabled:opacity-60"
        style={{ background: activo ? "#1FA971" : "#C3CBDE" }}
      >
        <span
          className="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left]"
          style={{ left: activo ? "27px" : "3px" }}
        />
      </button>
    </div>
  );
}

"use client";
// Alta de un movimiento de caja (gestor): gasto, desembolso, aporte o retiro.
// Los cobros NO se cargan acá (se registran en la calle). Guarda por Server
// Action y refresca el resumen.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { agregarMovimientoCaja } from "@/lib/acciones/caja";

const TIPOS = [
  { id: "egreso", label: "Gasto", cats: ["Combustible", "Sueldo", "Alquiler", "Comida", "Mantenimiento", "Otro"] },
  { id: "desembolso", label: "Desembolso", cats: ["Crédito nuevo", "Renovación", "Otro"] },
  { id: "ingreso", label: "Aporte / Ingreso", cats: ["Capital", "Otro"] },
  { id: "retiro", label: "Retiro del dueño", cats: ["Retiro", "Otro"] },
] as const;

export function FormMovimientoCaja() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["id"]>("egreso");
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("Combustible");
  const [descripcion, setDescripcion] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cats = TIPOS.find((t) => t.id === tipo)!.cats;
  const montoNum = Math.round(Number(monto));
  const valido = Number.isFinite(montoNum) && montoNum > 0;

  const guardar = () => {
    if (!valido || pendiente) return;
    setError(null);
    startTransition(async () => {
      const res = await agregarMovimientoCaja({ tipo, monto: montoNum, categoria, descripcion });
      if (res.ok) {
        setMonto("");
        setDescripcion("");
        setAbierto(false);
        router.refresh();
      } else setError(res.error);
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
      >
        + Registrar movimiento
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <span className="text-[13px] font-bold text-tinta">Nuevo movimiento de caja</span>

      <div className="flex flex-wrap gap-1.5">
        {TIPOS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTipo(t.id);
              setCategoria(t.cats[0]);
            }}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
              tipo === t.id ? "bg-[#2453DC] text-white" : "bg-[#EEF3FF] text-azul"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Monto (UYU)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] font-semibold outline-none focus:border-azul"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Categoría</span>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[14px] outline-none focus:border-azul"
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Descripción (opcional)</span>
        <input
          type="text"
          value={descripcion}
          maxLength={200}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej: nafta de la moto, adelanto a Diego…"
          className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
        />
      </label>

      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          disabled={pendiente}
          className="rounded-full border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-[#6B7494]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={!valido || pendiente}
          className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : "Guardar movimiento"}
        </button>
      </div>
    </div>
  );
}

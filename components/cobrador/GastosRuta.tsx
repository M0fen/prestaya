"use client";
// Gastos de ruta del cobrador (combustible, comida, etc.). Se cargan en el día
// y salen de la caja como egresos; al cerrar la jornada, se descuentan solos del
// efectivo a entregar. Mobile-first.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU, horaDe } from "@/lib/format";
import { agregarGastoRuta } from "@/lib/acciones/gastos";
import type { GastosCobradorHoy } from "@/lib/data/gastos";

const CATEGORIAS = ["Combustible", "Comida", "Peaje", "Otro"];

export function GastosRuta({ gastos }: { gastos: GastosCobradorHoy }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("Combustible");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const montoN = Math.round(Number(monto) || 0);

  const agregar = () => {
    if (montoN <= 0) return;
    setError(null);
    startTransition(async () => {
      const res = await agregarGastoRuta({ monto: montoN, categoria, descripcion: nota });
      if (res.ok) {
        setMonto(""); setNota("");
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex flex-col">
          <span className="text-[14px] font-extrabold text-tinta">Gastos de ruta</span>
          <span className="text-[12px] font-medium text-gris">
            {gastos.total > 0 ? `${UYU(gastos.total)} hoy` : "Sin gastos hoy"}
          </span>
        </div>
        <span className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul">
          {abierto ? "Cerrar" : "+ Gasto"}
        </span>
      </button>

      {abierto && (
        <div className="mt-3.5 flex flex-col gap-3 border-t border-[#EEF1F8] pt-3.5">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIAS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c)}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                  categoria === c ? "bg-[#2453DC] text-white" : "bg-[#EEF1F8] text-gris"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 rounded-[12px] border border-[#DCE3F4] px-3 py-2.5">
              <span className="text-[15px] font-bold text-gris">$</span>
              <input
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="w-full text-[16px] tabular-nums outline-none"
                aria-label="Monto del gasto"
              />
            </div>
            <button
              type="button"
              onClick={agregar}
              disabled={pendiente || montoN <= 0}
              className="rounded-[12px] bg-[#1FA971] px-4 py-2.5 text-[14px] font-extrabold text-white disabled:opacity-40"
            >
              {pendiente ? "…" : "Agregar"}
            </button>
          </div>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={160}
            placeholder="Nota (opcional)"
            className="w-full rounded-[12px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          />
          {error && <p className="text-[12px] font-semibold text-[#C0392B]">{error}</p>}

          {gastos.items.length > 0 && (
            <ul className="flex flex-col divide-y divide-[#EEF1F8]">
              {gastos.items.map((g, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-tinta">
                      {g.categoria ?? "Gasto"}
                      {g.descripcion ? <span className="font-normal text-gris"> · {g.descripcion}</span> : ""}
                    </span>
                    <span className="text-[11px] font-medium text-[#8A93AD]">{g.registradoEn ? horaDe(g.registradoEn) : "—"}</span>
                  </div>
                  <span className="flex-shrink-0 text-[13.5px] font-extrabold tabular-nums text-[#C0392B]">
                    −{UYU(g.monto)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

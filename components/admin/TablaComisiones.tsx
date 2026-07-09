"use client";
// Tabla de comisiones por cobrador. Cada fila: recaudado del período, tasa (%)
// editable (se guarda con auditoría) y comisión calculada en vivo, con botón
// para LIQUIDAR (registra el egreso en caja). Solo gestores llegan acá.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularComision } from "@/lib/comision";
import { setComisionPct, liquidarComision } from "@/lib/acciones/comisiones";
import type { FilaComision } from "@/lib/data/comisiones";

export function TablaComisiones({
  filas,
  etiqueta,
  totalRecaudado = 0,
  puedeGestionar = true,
}: {
  filas: FilaComision[];
  etiqueta: string;
  /** Total recaudado del período (para el % de participación de cada cobrador). */
  totalRecaudado?: number;
  /** Solo el admin puede fijar tasas y liquidar. El supervisor mira. */
  puedeGestionar?: boolean;
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
        No hay cobradores activos.
      </p>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-linea overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
      {filas.map((f) => (
        <Fila
          key={f.cobradorId}
          f={f}
          etiqueta={etiqueta}
          totalRecaudado={totalRecaudado}
          puedeGestionar={puedeGestionar}
        />
      ))}
    </div>
  );
}

function Fila({
  f,
  etiqueta,
  totalRecaudado,
  puedeGestionar,
}: {
  f: FilaComision;
  etiqueta: string;
  totalRecaudado: number;
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [pct, setPct] = useState(String(f.pct));
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const pctN = Math.max(0, Math.min(100, Number(pct) || 0));
  const comision = calcularComision(f.recaudado, pctN);
  const cambiado = pctN !== f.pct;

  const guardar = () => {
    setError(null); setOkMsg(null);
    startTransition(async () => {
      const res = await setComisionPct(f.cobradorId, pctN);
      if (res.ok) { setOkMsg("Guardado ✓"); router.refresh(); }
      else setError(res.error);
    });
  };

  const liquidar = () => {
    setError(null); setOkMsg(null);
    startTransition(async () => {
      // Si cambió la tasa, la persistimos antes de liquidar.
      if (cambiado) {
        const r1 = await setComisionPct(f.cobradorId, pctN);
        if (!r1.ok) { setError(r1.error); return; }
      }
      const res = await liquidarComision({ cobradorId: f.cobradorId, nombre: f.nombre, monto: comision, periodo: etiqueta });
      if (res.ok) { setOkMsg("Liquidada ✓"); router.refresh(); }
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-bold text-tinta">{f.nombre}</span>
          <span className="text-[11.5px] font-medium text-tenue">
            recaudó {UYU(f.recaudado)} · {f.cobros} cobro{f.cobros === 1 ? "" : "s"} · ticket{" "}
            {UYU(f.cobros > 0 ? Math.round(f.recaudado / f.cobros) : 0)}
            {totalRecaudado > 0 && ` · ${Math.round((f.recaudado / totalRecaudado) * 100)}% del total`}
          </span>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end">
          <span className="text-[15px] font-extrabold tabular-nums text-verde">{UYU(comision)}</span>
          <span className="text-[10.5px] font-semibold text-tenue">comisión</span>
        </div>
      </div>

      {puedeGestionar ? (
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-[11px] border border-borde px-2.5 py-1.5">
              <input
                inputMode="decimal"
                value={pct}
                onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-12 text-[14px] tabular-nums outline-none"
                aria-label={`Comisión de ${f.nombre}`}
              />
              <span className="text-[13px] font-bold text-gris">%</span>
            </div>
            <button
              type="button"
              onClick={guardar}
              disabled={pendiente || !cambiado}
              className="rounded-full border border-borde px-3 py-1.5 text-[12px] font-bold text-azul disabled:opacity-40"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={liquidar}
              disabled={pendiente || comision <= 0}
              className="ml-auto rounded-full bg-[#1FA971] px-3.5 py-1.5 text-[12px] font-extrabold text-white disabled:opacity-40"
            >
              {pendiente ? "…" : "Liquidar"}
            </button>
          </div>
          {error && <span className="text-[11px] font-semibold text-[#C0392B]">{error}</span>}
          {okMsg && <span className="text-[11px] font-semibold text-verde">{okMsg}</span>}
        </>
      ) : (
        // Supervisor: solo lectura (tasa vigente, sin poder cambiar ni liquidar).
        <span className="text-[11.5px] font-medium text-tenue">Comisión: {f.pct}%</span>
      )}
    </div>
  );
}

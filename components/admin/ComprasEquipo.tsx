"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Panel ADMIN "Compras del equipo" (0113): quién compró qué a crédito, cuándo
//  EMPEZÓ el crédito, el saldo, y el HISTORIAL de descuentos (cuánto se descontó
//  cada vez). Puede cancelar una compra (deja de descontarse). Money-visible.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarCompraEmpleado } from "@/lib/acciones/comprasEmpleado";
import type { CompraEmpleado, ResumenComprasEmpleado } from "@/lib/data/comprasEmpleado";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

export function ComprasEquipo({ compras, resumen }: { compras: CompraEmpleado[]; resumen: ResumenComprasEmpleado }) {
  const [verSaldadas, setVerSaldadas] = useState(false);
  const visibles = verSaldadas ? compras : compras.filter((c) => c.estado === "activa");

  return (
    <div className="flex flex-col gap-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Kpi valor={String(resumen.activas)} label="Compras activas" />
        <Kpi valor={UYU(resumen.saldoTotal)} label="Saldo por descontar" acento />
        <Kpi valor={String(resumen.compradores)} label="Compradores" />
      </div>

      {compras.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-borde bg-tarjeta p-6 text-center">
          <p className="text-[13px] font-bold text-tinta">Todavía nadie del equipo compró a crédito</p>
          <p className="mt-1 text-[12px] font-medium text-gris">Cuando un cobrador/supervisor compre en la tienda, aparece acá.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-gris">{visibles.length} {visibles.length === 1 ? "compra" : "compras"}</span>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-cuerpo">
              <input type="checkbox" checked={verSaldadas} onChange={(e) => setVerSaldadas(e.target.checked)} /> Ver saldadas/canceladas
            </label>
          </div>
          <ul className="flex flex-col gap-2.5">
            {visibles.map((c) => (
              <Fila key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Kpi({ valor, label, acento }: { valor: string; label: string; acento?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[14px] border p-3.5 ${acento ? "border-[#BFD4F5] bg-[#EEF3FF]" : "border-borde bg-tarjeta"}`}>
      <span className="text-[20px] font-black leading-none text-tinta tabular-nums tracking-[-0.02em]">{valor}</span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{label}</span>
    </div>
  );
}

function Fila({ c }: { c: CompraEmpleado }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const pagado = c.total - c.saldo;
  const pct = c.total > 0 ? Math.min(100, Math.round((pagado / c.total) * 100)) : 0;

  const cancelar = () =>
    start(async () => {
      const r = await cancelarCompraEmpleado({ id: c.id });
      if (r.ok) router.refresh();
    });

  return (
    <li className="flex flex-col gap-2.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-bold text-tinta">{c.empleadoNombre ?? "Empleado"}</span>
          <span className="truncate text-[12.5px] font-semibold text-cuerpo">{c.productoNombre}</span>
          <span className="text-[11.5px] font-medium text-gris">Empezó el {fecha(c.creadaEn)} · {c.cuotas} cuotas de {UYU(c.cuotaMonto)}</span>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${
            c.estado === "saldada" ? "bg-[#E4F5EC] text-[#157A50]" : c.estado === "cancelada" ? "bg-[#F1F3F9] text-gris" : "bg-[#FDF3E2] text-[#B9770E]"
          }`}
        >
          {c.estado === "saldada" ? "Saldada ✓" : c.estado === "cancelada" ? "Cancelada" : `Debe ${UYU(c.saldo)}`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF1F8]">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] font-bold text-gris tabular-nums">{UYU(pagado)} / {UYU(c.total)}</span>
      </div>

      {/* Historial de descuentos */}
      {c.descuentos.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[12px] bg-suave px-3 py-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">Descuentos de comisión</span>
          {c.descuentos.map((d, k) => (
            <div key={k} className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-cuerpo">{fecha(d.creadoEn)}</span>
              <span className="font-bold tabular-nums text-[#157A50]">−{UYU(d.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {c.estado === "activa" && (
        <div className="flex justify-end">
          {confirmar ? (
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-semibold text-gris">¿Cancelar? No se descuenta más.</span>
              <button type="button" disabled={pend} onClick={cancelar} className="min-h-[40px] rounded-full bg-[#D64545] px-3 py-2 text-[12px] font-bold text-white disabled:opacity-60">Sí, cancelar</button>
              <button type="button" onClick={() => setConfirmar(false)} className="min-h-[40px] rounded-full border border-borde px-3 py-2 text-[12px] font-bold text-cuerpo">No</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} className="rounded-full border border-[#F3C0B8] px-3 py-2 text-[12px] font-bold text-[#C0392B]">Cancelar compra</button>
          )}
        </div>
      )}
    </li>
  );
}

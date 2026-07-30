"use client";
// ─────────────────────────────────────────────────────────────────────────
//  CALCULADORA DE PRECIOS (admin). Herramientas profesionales para fijar precios:
//  margen (costo↔precio), financiación (cuota/total/interés ganado), ganancia por
//  venta, precio sugerido por margen objetivo, y comparador de planes de cuotas.
//  Todo con enteros (sin float). Se puede precargar un producto real.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const pct = (g: number, base: number) => (base > 0 ? Math.round((g / base) * 100) : 0);
// Fórmula CANÓNICA de la venta (igual que lib/venta.ts): cuota = techo(precio·(1+i/100)/n).
const cuotaDe = (precio: number, interes: number, cuotas: number) =>
  cuotas > 0 ? Math.ceil((precio * (1 + interes / 100)) / cuotas) : 0;

export interface ProductoCalc {
  id: string;
  nombre: string;
  precio: number;
  costo: number | null;
  interesPct: number;
  cuotas: number;
}

function Campo({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-bold text-cuerpo">{label}</span>
      {children}
      {hint && <span className="text-[11px] font-medium text-gris">{hint}</span>}
    </label>
  );
}
const INPUT = "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[15px] text-tinta tabular-nums outline-none focus:border-azul";

function Kpi({ valor, label, sub, acento }: { valor: string; label: string; sub?: string; acento?: "verde" | "azul" }) {
  const b = acento === "verde" ? "border-[#BFE6D2] bg-[#EAF7F0]" : acento === "azul" ? "border-[#BFD4F5] bg-[#EEF3FF]" : "border-borde bg-tarjeta";
  return (
    <div className={`flex flex-col gap-0.5 rounded-[14px] border p-3.5 ${b}`}>
      <span className="text-[22px] font-black leading-tight text-tinta tabular-nums tracking-[-0.02em]">{valor}</span>
      <span className="text-[11.5px] font-bold uppercase tracking-wide text-gris">{label}</span>
      {sub && <span className="text-[11px] font-medium text-gris">{sub}</span>}
    </div>
  );
}

export function CalculadoraPrecios({ productos }: { productos: ProductoCalc[] }) {
  const [costo, setCosto] = useState(5000);
  const [precio, setPrecio] = useState(8000);
  const [interes, setInteres] = useState(0);
  const [cuotas, setCuotas] = useState(30);
  const [margenObjetivo, setMargenObjetivo] = useState(40);

  const cargar = (id: string) => {
    const p = productos.find((x) => x.id === id);
    if (!p) return;
    setPrecio(p.precio);
    setCosto(p.costo ?? Math.round(p.precio * 0.6));
    setInteres(p.interesPct);
    setCuotas(p.cuotas || 30);
  };

  const r = useMemo(() => {
    const cuota = cuotaDe(precio, interes, cuotas);
    const totalCobrar = cuota * cuotas;
    const interesGanado = Math.max(0, totalCobrar - precio);
    const gananciaContado = precio - costo;                 // margen de mercadería
    const gananciaFinanciada = totalCobrar - costo;         // + interés ganado
    // Precio sugerido para el margen objetivo: precio = costo / (1 − margen/100).
    const m = Math.min(95, Math.max(0, margenObjetivo));
    const precioSugerido = m < 100 ? Math.round(costo / (1 - m / 100)) : 0;
    return { cuota, totalCobrar, interesGanado, gananciaContado, gananciaFinanciada, precioSugerido };
  }, [costo, precio, interes, cuotas, margenObjetivo]);

  const planes = [6, 12, 18, 24, 36].map((n) => {
    const c = cuotaDe(precio, interes, n);
    const total = c * n;
    return { n, cuota: c, total, ganancia: total - costo };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Precargar un producto real */}
      {productos.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
          <span className="text-[12.5px] font-bold text-cuerpo">Cargar de un producto:</span>
          <select onChange={(e) => cargar(e.target.value)} defaultValue="" className="rounded-[10px] border border-borde bg-tarjeta px-3 py-1.5 text-[13px] text-tinta outline-none">
            <option value="" disabled>Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} · {UYU(p.precio)}{p.costo == null ? " (sin costo)" : ""}</option>
            ))}
          </select>
        </label>
      )}

      {/* Entradas */}
      <div className="grid gap-3 rounded-[16px] border border-borde bg-tarjeta p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Costo (lo que te cuesta)"><input type="number" inputMode="numeric" value={costo || ""} onChange={(e) => setCosto(Math.max(0, Math.round(Number(e.target.value) || 0)))} className={INPUT} /></Campo>
        <Campo label="Precio de venta (contado)"><input type="number" inputMode="numeric" value={precio || ""} onChange={(e) => setPrecio(Math.max(0, Math.round(Number(e.target.value) || 0)))} className={INPUT} /></Campo>
        <Campo label="Interés de financiación %"><input type="number" inputMode="decimal" value={interes || ""} onChange={(e) => setInteres(Math.max(0, Number(e.target.value) || 0))} className={INPUT} /></Campo>
        <Campo label="Nº de cuotas"><input type="number" inputMode="numeric" value={cuotas || ""} onChange={(e) => setCuotas(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={INPUT} /></Campo>
      </div>

      {/* Resultados */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi valor={UYU(r.gananciaContado)} label="Ganancia contado" sub={`margen ${pct(r.gananciaContado, precio)}%`} acento="verde" />
        <Kpi valor={`${r.cuota > 0 ? cuotas + "× " : ""}${UYU(r.cuota)}`} label="Cuota" sub={`total ${UYU(r.totalCobrar)}`} acento="azul" />
        <Kpi valor={UYU(r.interesGanado)} label="Interés ganado" sub="por financiar" />
        <Kpi valor={UYU(r.gananciaFinanciada)} label="Ganancia total" sub={`= total cobrado − costo`} acento="verde" />
      </div>

      {/* Precio sugerido por margen objetivo */}
      <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-extrabold text-tinta">Precio sugerido por margen</span>
          <span className="text-[13px] font-black text-azul">{margenObjetivo}%</span>
        </div>
        <input type="range" min={0} max={90} step={5} value={margenObjetivo} onChange={(e) => setMargenObjetivo(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#DCE3F4] accent-[#1E47C8]" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-gris">Para ganar <b className="text-tinta">{margenObjetivo}%</b> sobre un costo de <b className="text-tinta">{UYU(costo)}</b>, vendé a:</span>
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-black tabular-nums text-[#157A50]">{UYU(r.precioSugerido)}</span>
            <button type="button" onClick={() => setPrecio(r.precioSugerido)} className="rounded-full bg-[#1E47C8] px-3 py-1.5 text-[12px] font-bold text-white active:scale-95">Usar</button>
          </div>
        </div>
      </div>

      {/* Comparador de planes de cuotas */}
      <div className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[13px] font-extrabold text-tinta">Planes de cuotas (con este precio/costo/interés)</span>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-gris">
                <th className="py-1.5 pr-2">Plan</th>
                <th className="py-1.5 pr-2 text-right">Cuota</th>
                <th className="py-1.5 pr-2 text-right">Total a cobrar</th>
                <th className="py-1.5 text-right">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {planes.map((p) => (
                <tr key={p.n} className="border-t border-linea">
                  <td className="py-1.5 pr-2 font-semibold text-tinta">{p.n} cuotas</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-cuerpo">{UYU(p.cuota)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-cuerpo">{UYU(p.total)}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-[#157A50]">{UYU(p.ganancia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[11px] font-medium text-gris">
        Cuota = techo(precio × (1 + interés/100) ÷ cuotas), igual que la venta real. Todo en pesos enteros.
      </p>
    </div>
  );
}

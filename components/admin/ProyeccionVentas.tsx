"use client";
// ─────────────────────────────────────────────────────────────────────────
//  SIMULADOR DE PROYECCIÓN DE VENTAS de la tienda. Toma números REALES (clientes
//  activos, ticket promedio del catálogo) y deja al admin mover supuestos
//  (adopción, ticket, artículos, margen, horizonte) para ver cuánto puede facturar
//  la tienda. Es una herramienta de decisión + demo comercial de la plataforma.
//  Todo se calcula en el cliente; nada se guarda.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import type { BaseProyeccion } from "@/lib/data/proyeccion";

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const compact = (n: number) => {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "k";
  return "$" + Math.round(n);
};

type Preset = "conservador" | "realista" | "optimista";
const PRESETS: Record<Preset, { adopcion: number; articulos: number; margen: number; label: string; emoji: string }> = {
  conservador: { adopcion: 1, articulos: 1, margen: 20, label: "Conservador", emoji: "🌱" },
  realista: { adopcion: 3, articulos: 1, margen: 30, label: "Realista", emoji: "📊" },
  optimista: { adopcion: 6, articulos: 2, margen: 40, label: "Optimista", emoji: "🚀" },
};

function Slider({
  label, valor, min, max, step, onChange, formato, ayuda,
}: {
  label: string; valor: number; min: number; max: number; step: number;
  onChange: (v: number) => void; formato: (v: number) => string; ayuda?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-bold text-cuerpo">{label}</span>
        <span className="text-[14px] font-black text-azul tabular-nums">{formato(valor)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#DCE3F4] accent-[#1E47C8]"
      />
      {ayuda && <span className="text-[11px] font-medium text-gris">{ayuda}</span>}
    </div>
  );
}

export function ProyeccionVentas({ base }: { base: BaseProyeccion }) {
  const [clientes, setClientes] = useState(base.clientesActivos || 1000);
  const [adopcion, setAdopcion] = useState(3); // % de clientes que compran por mes
  const [ticket, setTicket] = useState(base.precioPromedio || 2500);
  const [articulos, setArticulos] = useState(1);
  const [margen, setMargen] = useState(30); // % de ganancia por financiación
  const [meses, setMeses] = useState(12);

  const aplicarPreset = (p: Preset) => {
    const cfg = PRESETS[p];
    setAdopcion(cfg.adopcion);
    setArticulos(cfg.articulos);
    setMargen(cfg.margen);
  };

  const r = useMemo(() => {
    const compradoresMes = clientes * (adopcion / 100);
    const ventasMes = compradoresMes * articulos;
    const facturacionMes = ventasMes * ticket;
    const gananciaMes = facturacionMes * (margen / 100);
    const facturacionHorizonte = facturacionMes * meses;
    const gananciaHorizonte = gananciaMes * meses;
    // Serie acumulada (crecimiento lineal) para el gráfico.
    const serie = Array.from({ length: meses }, (_, i) => facturacionMes * (i + 1));
    return { compradoresMes, ventasMes, facturacionMes, gananciaMes, facturacionHorizonte, gananciaHorizonte, serie };
  }, [clientes, adopcion, ticket, articulos, margen, meses]);

  const maxSerie = r.serie[r.serie.length - 1] || 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold text-gris">Escenario:</span>
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => aplicarPreset(p)}
            className="flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[12px] font-bold text-cuerpo hover:border-azul hover:text-azul"
          >
            <span>{PRESETS[p].emoji}</span> {PRESETS[p].label}
          </button>
        ))}
      </div>

      {/* Número protagonista + ganancia */}
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#173063,#0F1B3D)] p-5 text-white shadow-[0_14px_34px_rgba(15,27,61,0.3)]">
          <span className="text-[12px] font-bold uppercase tracking-wide text-white/55">Facturación proyectada · {meses} meses</span>
          <div className="mt-1 text-[38px] font-black leading-none tabular-nums tracking-[-0.02em]">{money(r.facturacionHorizonte)}</div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] font-semibold text-white/75">
            <span>≈ {money(r.facturacionMes)} / mes</span>
            <span>{Math.round(r.ventasMes).toLocaleString("es-UY")} ventas / mes</span>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-1 rounded-[20px] border border-[#BFE6D2] bg-[#EAF7F0] p-5">
          <span className="text-[12px] font-bold uppercase tracking-wide text-[#157A50]">Ganancia por financiación</span>
          <div className="text-[30px] font-black leading-none text-[#0F7A48] tabular-nums tracking-[-0.02em]">{money(r.gananciaHorizonte)}</div>
          <span className="text-[12px] font-semibold text-[#157A50]">≈ {money(r.gananciaMes)} / mes · margen {margen}%</span>
        </div>
      </div>

      {/* Gráfico de facturación acumulada */}
      <div className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-extrabold text-tinta">Facturación acumulada</span>
          <span className="text-[11.5px] font-medium text-gris">mes 1 → {meses}</span>
        </div>
        <div className="flex h-[120px] items-end gap-[3px]">
          {r.serie.map((v, i) => (
            <div key={i} className="group relative flex-1 rounded-t-[3px] bg-[linear-gradient(180deg,#2453DC,#1E47C8)] transition-all" style={{ height: `${Math.max(3, (v / maxSerie) * 100)}%` }}>
              <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-tinta px-1.5 py-0.5 text-[10px] font-bold text-white group-hover:block">
                {compact(v)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div className="grid gap-x-6 gap-y-4 rounded-[16px] border border-borde bg-tarjeta p-4 md:grid-cols-2">
        <Slider label="Clientes alcanzables" valor={clientes} min={100} max={Math.max(5000, base.clientesActivos)} step={100} onChange={setClientes}
          formato={(v) => v.toLocaleString("es-UY")} ayuda={base.clientesActivos ? `Reales hoy: ${base.clientesActivos.toLocaleString("es-UY")} activos` : undefined} />
        <Slider label="Compran por mes" valor={adopcion} min={0.5} max={15} step={0.5} onChange={setAdopcion}
          formato={(v) => `${v}%`} ayuda={`${Math.round(r.compradoresMes).toLocaleString("es-UY")} clientes/mes`} />
        <Slider label="Ticket promedio" valor={ticket} min={500} max={40000} step={100} onChange={setTicket}
          formato={money} ayuda={base.precioPromedio ? `Catálogo hoy: ${money(base.precioPromedio)}` : undefined} />
        <Slider label="Artículos por comprador" valor={articulos} min={1} max={3} step={1} onChange={setArticulos}
          formato={(v) => `${v}×`} />
        <Slider label="Margen por financiación" valor={margen} min={0} max={100} step={5} onChange={setMargen}
          formato={(v) => `${v}%`} ayuda="Ganancia sobre el precio de contado" />
        <Slider label="Horizonte" valor={meses} min={3} max={36} step={1} onChange={setMeses}
          formato={(v) => `${v} meses`} />
      </div>

      {/* Nota + realidad */}
      <p className="text-center text-[11.5px] font-medium text-gris">
        Proyección con supuestos que vos elegís. {base.ventasReales > 0
          ? `Ventas de tienda reales hasta ahora: ${base.ventasReales} (${money(base.ingresoReal)}).`
          : "Todavía sin ventas de tienda registradas — movés los valores para estimar el potencial."}
      </p>
    </div>
  );
}

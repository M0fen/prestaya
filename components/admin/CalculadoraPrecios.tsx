"use client";
// ─────────────────────────────────────────────────────────────────────────
//  CALCULADORA DE PRECIOS (admin). Herramienta de PRICING: partís del costo y te
//  dice A CUÁNTO venderlo, CÓMO quedan las cuotas y CUÁNTO ganás — y podés CREAR
//  el producto (o guardar los precios en uno existente) directo desde acá.
//  Todo con enteros (sin float), misma fórmula que la venta real.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { guardarProducto, guardarPreciosProducto } from "@/lib/acciones/tienda";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const pct = (g: number, base: number) => (base > 0 ? Math.round((g / base) * 100) : 0);
// Fórmula CANÓNICA de la venta (igual que lib/venta.ts): cuota = techo(precio·(1+i/100)/n).
const cuotaDe = (precio: number, interes: number, cuotas: number) =>
  cuotas > 0 ? Math.ceil((precio * (1 + interes / 100)) / cuotas) : 0;

const FRECUENCIAS = ["diario", "semanal", "quincenal", "mensual"] as const;
type Frecuencia = (typeof FRECUENCIAS)[number];
const FREC_LABEL: Record<Frecuencia, string> = {
  diario: "por día", semanal: "por semana", quincenal: "por quincena", mensual: "por mes",
};

export interface ProductoCalc {
  id: string;
  nombre: string;
  precio: number;
  costo: number | null;
  interesPct: number;
  cuotas: number;
  frecuencia: string;
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
const INPUT = "rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[16px] text-tinta tabular-nums outline-none focus:border-azul";

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
  const router = useRouter();
  const [pend, start] = useTransition();
  const [costo, setCosto] = useState(5000);
  const [precio, setPrecio] = useState(8000);
  const [interes, setInteres] = useState(0);
  const [cuotas, setCuotas] = useState(12);
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("semanal");
  const [margenObjetivo, setMargenObjetivo] = useState(40);
  // Alta / guardado de producto.
  const [nombre, setNombre] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [loadedNombre, setLoadedNombre] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "err"; txt: string } | null>(null);

  const cargar = (id: string) => {
    const p = productos.find((x) => x.id === id);
    if (!p) return;
    setPrecio(p.precio);
    setCosto(p.costo ?? Math.round(p.precio * 0.6));
    setInteres(p.interesPct);
    setCuotas(p.cuotas || 12);
    if (FRECUENCIAS.includes(p.frecuencia as Frecuencia)) setFrecuencia(p.frecuencia as Frecuencia);
    setLoadedId(p.id);
    setLoadedNombre(p.nombre);
    setNombre(p.nombre);
    setMsg(null);
  };
  const modoNuevo = () => { setLoadedId(null); setLoadedNombre(""); setNombre(""); setMsg(null); };

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

  const crear = () =>
    start(async () => {
      setMsg(null);
      if (!nombre.trim()) { setMsg({ tipo: "err", txt: "Poné un nombre para el producto." }); return; }
      const res = await guardarProducto({
        nombre: nombre.trim(), precio, interesPct: interes, cuotas, frecuencia,
        costo, fotos: [], activo: true, destacado: false, orden: 0,
      });
      if (res.ok) { setMsg({ tipo: "ok", txt: "✓ Producto creado. Agregale fotos y descripción en Tienda." }); modoNuevo(); router.refresh(); }
      else setMsg({ tipo: "err", txt: res.error });
    });

  const guardarEn = () =>
    start(async () => {
      setMsg(null);
      if (!loadedId) return;
      const res = await guardarPreciosProducto({ id: loadedId, precio, costo, interesPct: interes, cuotas, frecuencia });
      if (res.ok) { setMsg({ tipo: "ok", txt: `✓ Precios guardados en "${loadedNombre}".` }); router.refresh(); }
      else setMsg({ tipo: "err", txt: res.error });
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Precargar un producto real */}
      {productos.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 rounded-[14px] border border-borde bg-tarjeta p-3">
          <span className="text-[12.5px] font-bold text-cuerpo">Partí de un producto:</span>
          <select onChange={(e) => cargar(e.target.value)} value={loadedId ?? ""} className="rounded-[10px] border border-borde bg-tarjeta px-3 py-1.5 text-[16px] text-tinta outline-none">
            <option value="" disabled>Elegí un producto…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} · {UYU(p.precio)}{p.costo == null ? " (sin costo)" : ""}</option>
            ))}
          </select>
          {loadedId && <button type="button" onClick={modoNuevo} className="text-[12px] font-bold text-azul hover:underline">o crear uno nuevo</button>}
        </label>
      )}

      {/* Entradas */}
      <div className="grid gap-3 rounded-[16px] border border-borde bg-tarjeta p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Costo (lo que te cuesta)" hint="Para calcular tu ganancia."><input type="number" inputMode="numeric" value={costo || ""} onChange={(e) => setCosto(Math.max(0, Math.round(Number(e.target.value) || 0)))} className={INPUT} /></Campo>
        <Campo label="Precio de venta" hint="A cuánto lo ofrecés (contado)."><input type="number" inputMode="numeric" value={precio || ""} onChange={(e) => setPrecio(Math.max(0, Math.round(Number(e.target.value) || 0)))} className={INPUT} /></Campo>
        <Campo label="Interés de financiación %" hint="0 = cuotas sin interés."><input type="number" inputMode="decimal" value={interes || ""} onChange={(e) => setInteres(Math.max(0, Number(e.target.value) || 0))} className={INPUT} /></Campo>
        <Campo label="Nº de cuotas"><input type="number" inputMode="numeric" min={1} max={1000} value={cuotas || ""} onChange={(e) => setCuotas(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={INPUT} /></Campo>
        <Campo label="Frecuencia de cobro">
          <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as Frecuencia)} className={INPUT}>
            {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Campo>
      </div>

      {/* RECOMENDACIÓN — la respuesta clara: a cuánto venderlo y cómo las cuotas. */}
      <div className="rounded-[18px] border border-[#BFD4F5] bg-[linear-gradient(135deg,#EEF3FF,#F7FAFF)] p-4">
        <span className="text-[11px] font-black uppercase tracking-[0.08em] text-azul">Recomendación de venta</span>
        <p className="mt-1.5 text-[15.5px] font-semibold leading-[1.55] text-cuerpo">
          Vendé este producto a <b className="text-[#13308C]">{UYU(precio)}</b>
          {" — "}<b className="text-[#13308C] tabular-nums">{cuotas}× {UYU(r.cuota)}</b> {FREC_LABEL[frecuencia]}.
          Cobrás <b className="tabular-nums">{UYU(r.totalCobrar)}</b> en total y{" "}
          <b className="text-[#157A50]">ganás {UYU(r.gananciaFinanciada)}</b>
          {costo > 0 && <> <span className="text-gris">(margen {pct(r.gananciaContado, precio)}% + {UYU(r.interesGanado)} de interés)</span></>}.
        </p>
      </div>

      {/* Desglose */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi valor={`${r.cuota > 0 ? cuotas + "× " : ""}${UYU(r.cuota)}`} label="Cuota" sub={FREC_LABEL[frecuencia]} acento="azul" />
        <Kpi valor={UYU(r.totalCobrar)} label="Total a cobrar" sub={`en ${cuotas} cuotas`} />
        <Kpi valor={UYU(r.gananciaContado)} label="Ganancia contado" sub={`margen ${pct(r.gananciaContado, precio)}%`} acento="verde" />
        <Kpi valor={UYU(r.gananciaFinanciada)} label="Ganancia total" sub="con la financiación" acento="verde" />
      </div>

      {/* Precio sugerido por margen objetivo */}
      <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-extrabold text-tinta">¿No sabés a cuánto venderlo? Elegí tu margen</span>
          <span className="text-[13px] font-black text-azul">{margenObjetivo}%</span>
        </div>
        <input type="range" min={0} max={90} step={5} value={margenObjetivo} onChange={(e) => setMargenObjetivo(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#DCE3F4] accent-[#1E47C8]" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-gris">Para ganar <b className="text-tinta">{margenObjetivo}%</b> sobre un costo de <b className="text-tinta">{UYU(costo)}</b>, vendé a:</span>
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-black tabular-nums text-[#157A50]">{UYU(r.precioSugerido)}</span>
            <button type="button" onClick={() => setPrecio(r.precioSugerido)} className="rounded-full bg-[#1E47C8] px-3 py-1.5 text-[12px] font-bold text-white active:scale-95">Usar este precio</button>
          </div>
        </div>
      </div>

      {/* Comparador de planes de cuotas */}
      <div className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[13px] font-extrabold text-tinta">Opciones de cuotas (con este precio y costo)</span>
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
                <tr key={p.n} className={`border-t border-linea ${p.n === cuotas ? "bg-[#EEF3FF]" : ""}`}>
                  <td className="py-1.5 pr-2 font-semibold text-tinta">
                    {p.n} cuotas
                    <button type="button" onClick={() => setCuotas(p.n)} className="ml-1.5 text-[11px] font-bold text-azul hover:underline">usar</button>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-cuerpo">{UYU(p.cuota)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-cuerpo">{UYU(p.total)}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-[#157A50]">{UYU(p.ganancia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREAR / GUARDAR el producto con estos precios */}
      <div className="flex flex-col gap-2.5 rounded-[16px] border border-[#BFE6D2] bg-[#F3FBF6] p-4">
        <span className="text-[13px] font-extrabold text-[#157A50]">
          {loadedId ? "Guardar estos precios en el producto" : "Crear el producto con estos precios"}
        </span>
        {loadedId ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-cuerpo">Producto: <b className="text-tinta">{loadedNombre}</b></span>
            <button type="button" onClick={guardarEn} disabled={pend}
              className="rounded-full bg-[#1FA971] px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-50">
              {pend ? "Guardando…" : "💾 Guardar precios"}
            </button>
            <span className="text-[11px] font-medium text-gris">(no toca fotos ni descripción)</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Campo label="Nombre del producto">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Heladera No Frost 300L"
                className="w-64 max-w-full rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[16px] text-tinta outline-none focus:border-azul" />
            </Campo>
            <button type="button" onClick={crear} disabled={pend}
              className="rounded-full bg-[#1FA971] px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-50">
              {pend ? "Creando…" : "➕ Crear producto"}
            </button>
          </div>
        )}
        {msg && (
          <p className={`text-[12.5px] font-bold ${msg.tipo === "ok" ? "text-[#157A50]" : "text-[#B23B3B]"}`}>
            {msg.txt}
            {msg.tipo === "ok" && <> <Link href="/admin/tienda" className="font-bold text-azul hover:underline">Ir a Tienda →</Link></>}
          </p>
        )}
      </div>

      <p className="text-center text-[11px] font-medium text-gris">
        Cuota = techo(precio × (1 + interés/100) ÷ cuotas), igual que la venta real. Todo en pesos enteros.
      </p>
    </div>
  );
}

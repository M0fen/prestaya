// ─────────────────────────────────────────────────────────────────────────
//  Dashboard "Ganancias de la tienda" (0114). De dónde viene cada peso: ventas a
//  clientes vs compras del equipo, Curbe vs propios, y la rentabilidad por
//  producto (costo → ganancia → margen). Display-only (server component).
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import type { GananciasTienda as G, BloqueGanancia, ProductoGanancia } from "@/lib/data/ganancias";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const pct = (g: number, v: number) => (v > 0 ? Math.round((g / v) * 100) : 0);

function Kpi({ icono, valor, label, sub, acento }: { icono: string; valor: string; label: string; sub?: string; acento?: "verde" | "azul" }) {
  const borde = acento === "verde" ? "border-[#BFE6D2] bg-[#EAF7F0]" : acento === "azul" ? "border-[#BFD4F5] bg-[#EEF3FF]" : "border-borde bg-tarjeta";
  return (
    <div className={`flex flex-col gap-1 rounded-[16px] border p-4 ${borde}`}>
      <span className="text-[17px] leading-none">{icono}</span>
      <span className="text-[24px] font-black leading-tight text-tinta tabular-nums tracking-[-0.02em]">{valor}</span>
      <span className="text-[11.5px] font-bold uppercase tracking-wide text-gris">{label}</span>
      {sub && <span className="text-[11px] font-medium text-gris">{sub}</span>}
    </div>
  );
}

/** Tarjeta de un origen (canal o proveedor) con su vendido + ganancia. */
function OrigenCard({ emoji, titulo, b, color }: { emoji: string; titulo: string; b: BloqueGanancia; color: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold text-tinta">{emoji} {titulo}</span>
        <span className="text-[11px] font-bold text-gris">{b.unidades} {b.unidades === 1 ? "venta" : "ventas"}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-gris">Ganancia</span>
        <span className="text-[18px] font-black tabular-nums" style={{ color }}>{UYU(b.ganancia)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px] font-medium text-gris">
        <span>Vendido {UYU(b.vendido)}</span>
        <span>margen {pct(b.ganancia, b.vendido)}%</span>
      </div>
      {b.sinCosto > 0 && <span className="text-[10.5px] font-semibold text-[#B9770E]">⚠ {b.sinCosto} sin costo definido</span>}
    </div>
  );
}

export function GananciasTiendaPanel({ g }: { g: G }) {
  const hayVentas = g.total.unidades > 0;
  return (
    <div className="flex flex-col gap-5">
      {/* KPIs totales */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi icono="🛒" valor={UYU(g.total.vendido)} label="Vendido" sub={`${g.total.unidades} ventas`} />
        <Kpi icono="💰" valor={UYU(g.total.ganancia)} label="Ganancia proyectada" sub={`margen ${pct(g.total.ganancia, g.total.vendido)}%`} acento="verde" />
        <Kpi icono="💵" valor={UYU(g.total.cobrado)} label="Ya cobrado" sub="cash real hasta ahora" acento="azul" />
        <Kpi icono="📦" valor={UYU(g.total.costo)} label="Costo de la mercadería" />
      </div>

      {g.productosSinCosto > 0 && (
        <Link href="/admin/tienda" className="flex items-center justify-between gap-3 rounded-[14px] border border-[#F2D9A8] bg-[#FDF6E9] px-4 py-3">
          <span className="text-[12.5px] font-semibold text-[#8A6A16]">
            💡 {g.productosSinCosto} producto{g.productosSinCosto === 1 ? "" : "s"} sin costo definido. Cargá el costo para ver tu ganancia real.
          </span>
          <span className="shrink-0 text-[12px] font-bold text-[#B9770E]">Definir →</span>
        </Link>
      )}

      {/* De dónde viene: por CANAL */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[14px] font-extrabold text-tinta">¿De dónde viene? · por canal</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <OrigenCard emoji="🧑‍🤝‍🧑" titulo="Ventas a clientes" b={g.porCanal.clientes} color="#157A50" />
          <OrigenCard emoji="🧾" titulo="Compras del equipo" b={g.porCanal.equipo} color="#1E47C8" />
        </div>
      </section>

      {/* De dónde viene: por PROVEEDOR */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[14px] font-extrabold text-tinta">¿De dónde viene? · por proveedor</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <OrigenCard emoji="💎" titulo="Curbe" b={g.porProveedor.curbe} color="#6D4AC7" />
          <OrigenCard emoji="🏠" titulo="Propios" b={g.porProveedor.propios} color="#157A50" />
        </div>
      </section>

      {/* Rentabilidad por producto */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[14px] font-extrabold text-tinta">Rentabilidad por producto</h2>
        {g.porProducto.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-borde bg-tarjeta p-5 text-center text-[12.5px] font-medium text-gris">
            {hayVentas ? "Sin datos por producto." : "Todavía sin ventas. Acá vas a ver cuánto te deja cada producto."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-borde">
            <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-suave text-left text-[11px] font-bold uppercase tracking-wide text-gris">
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Ventas</th>
                  <th className="px-3 py-2 text-right">Vendido</th>
                  <th className="px-3 py-2 text-right">Ganancia</th>
                  <th className="px-3 py-2 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {g.porProducto.map((p: ProductoGanancia) => (
                  <tr key={p.productoId ?? p.nombre} className="border-t border-linea">
                    <td className="px-3 py-2 font-semibold text-tinta">
                      {p.proveedor === "curbe" ? "💎 " : ""}{p.nombre}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-cuerpo">{p.unidades}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-cuerpo">{UYU(p.vendido)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-[#157A50]">{p.ganancia == null ? "—" : UYU(p.ganancia)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gris">{p.ganancia == null ? "sin costo" : `${pct(p.ganancia, p.vendido)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-[11px] font-medium text-gris">
        Ganancia proyectada = total a cobrar − costo. “Ya cobrado” es el efectivo real ingresado hasta ahora.
      </p>
    </div>
  );
}

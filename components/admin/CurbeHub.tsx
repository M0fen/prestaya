// ─────────────────────────────────────────────────────────────────────────
//  HUB DE LA INTEGRACIÓN CURBE (0112). El "espacio Curbe" del panel: KPIs de la
//  integración (catálogo, ventas, ingresos, despacho), la cola de despacho y el
//  catálogo Curbe. Server component (los datos vienen de la página); la cola de
//  despacho es el único trozo interactivo.
import Link from "next/link";
import { PedidosCurbe } from "@/components/admin/PedidosCurbe";
import type { CurbeResumen, PedidoCurbe } from "@/lib/data/pedidosCurbe";
import type { Producto } from "@/lib/data/tienda";

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");

function Kpi({ icono, valor, label, sub, acento }: { icono: string; valor: string; label: string; sub?: string; acento?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[14px] border p-3.5 ${acento ? "border-[#C9B8F0] bg-[#F3EEFC]" : "border-borde bg-tarjeta"}`}>
      <span className="text-[18px] leading-none">{icono}</span>
      <span className="text-[22px] font-black leading-tight text-tinta tabular-nums tracking-[-0.02em]">{valor}</span>
      <span className="text-[11.5px] font-bold uppercase tracking-wide text-gris">{label}</span>
      {sub && <span className="text-[11px] font-medium text-gris">{sub}</span>}
    </div>
  );
}

const CAT_COLOR: Record<string, { bg: string; fg: string }> = {
  "Para Ella": { bg: "#FBE9F1", fg: "#B03A6E" },
  "Para Él": { bg: "#E7EEFC", fg: "#2453DC" },
  Unisex: { bg: "#E6F5EE", fg: "#1E8A5B" },
  "Oro 18k": { bg: "#F7EFD8", fg: "#9A7A1E" },
};

export function CurbeHub({
  resumen,
  productos,
  pedidos,
}: {
  resumen: CurbeResumen;
  productos: Producto[];
  pedidos: PedidoCurbe[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">← Volver a Tienda</Link>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">💎 Integración Curbe</h1>
            <span className="text-[13px] font-medium text-gris">
              Vendemos el catálogo de Curbe (perfumes + joyería oro 18k) financiado, y le pasamos el pedido para que despache.
            </span>
          </div>
          <Link href="/tienda" target="_blank" className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-3.5 py-2 text-[12.5px] font-bold text-azul hover:bg-suave">
            🌐 Ver en la tienda
          </Link>
        </div>
      </header>

      {/* KPIs de la integración */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Kpi icono="💎" valor={String(resumen.productosCurbe)} label="Productos Curbe" sub={`${resumen.productosActivos} activos`} acento />
        <Kpi icono="🛍️" valor={String(resumen.ventas)} label="Ventas" sub="créditos generados" />
        <Kpi icono="💰" valor={money(resumen.totalVendido)} label="Total vendido" sub="lo que pagan los clientes" />
        <Kpi icono="📦" valor={String(resumen.porDespachar)} label="Por despachar" sub="esperan a Curbe" />
        <Kpi icono="✅" valor={String(resumen.despachados)} label="Despachados" />
      </div>

      {/* Cola de despacho (interactiva). Si no hay pedidos, PedidosCurbe no renderiza
          → mostramos un vacío explicativo para que el espacio no quede "roto". */}
      {pedidos.length > 0 ? (
        <PedidosCurbe pedidos={pedidos} />
      ) : (
        <div className="rounded-[16px] border border-dashed border-borde bg-tarjeta p-5 text-center">
          <p className="text-[13px] font-bold text-tinta">Sin pedidos a Curbe todavía</p>
          <p className="mt-1 text-[12px] font-medium text-gris">
            Cuando un cliente compre un producto de Curbe, el pedido de despacho aparece acá para que les avises.
          </p>
        </div>
      )}

      {/* Catálogo Curbe */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-extrabold text-tinta">Catálogo Curbe ({productos.length})</h2>
          <Link href="/admin/tienda" className="text-[12px] font-bold text-azul">Editar en Tienda →</Link>
        </div>
        {productos.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-borde bg-tarjeta p-5 text-center">
            <p className="text-[13px] font-bold text-tinta">Todavía no hay productos de Curbe</p>
            <p className="mt-1 text-[12px] font-medium text-gris">
              Corré <code className="font-bold">scripts/importar-curbe.mjs</code> o creá un producto en Tienda eligiendo “💎 Curbe” como despacho.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {productos.map((p) => {
              const cat = p.categoriaNombre ? CAT_COLOR[p.categoriaNombre] : undefined;
              return (
                <div key={p.id} className="flex flex-col overflow-hidden rounded-[14px] border border-borde bg-tarjeta">
                  <div className="relative aspect-square bg-suave">
                    {p.fotos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.fotos[0]} alt={p.nombre} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[28px]">💎</div>
                    )}
                    {!p.activo && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-[#F1F3F9] px-2 py-0.5 text-[10px] font-bold text-gris">Pausado</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <span className="line-clamp-2 text-[12.5px] font-bold leading-tight text-tinta">{p.nombre}</span>
                    <div className="mt-auto flex items-center justify-between gap-1 pt-1">
                      <span className="text-[13px] font-black text-tinta tabular-nums">{money(p.precio)}</span>
                      {cat && (
                        <span className="rounded-full px-2 py-0.5 text-[9.5px] font-bold" style={{ background: cat.bg, color: cat.fg }}>
                          {p.categoriaNombre}
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] font-medium text-gris">{p.cuotas} cuotas · {p.frecuencia}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  "Ventas a clientes" (control): los créditos que vinieron de una compra en la
//  tienda. Quién compró qué, inicio, progreso pagado/total, cuánto falta. Cada
//  fila enlaza a la ficha del cliente. Display-only (server component).
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import type { VentaCliente, ResumenVentasClientes } from "@/lib/data/ventasClientes";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "short", year: "numeric" }).format(new Date(String(iso).slice(0, 10) + "T12:00:00"));

const ESTADO: Record<string, { label: string; bg: string; fg: string }> = {
  activo: { label: "En curso", bg: "#FDF3E2", fg: "#B9770E" },
  finalizado: { label: "Pagado ✓", bg: "#E4F5EC", fg: "#157A50" },
  incobrable: { label: "Incobrable", bg: "#FBE4E2", fg: "#C0392B" },
};

function Kpi({ valor, label, acento }: { valor: string; label: string; acento?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[14px] border p-3.5 ${acento ? "border-[#BFE6D2] bg-[#EAF7F0]" : "border-borde bg-tarjeta"}`}>
      <span className="text-[20px] font-black leading-none text-tinta tabular-nums tracking-[-0.02em]">{valor}</span>
      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">{label}</span>
    </div>
  );
}

export function VentasClientes({ ventas, resumen }: { ventas: VentaCliente[]; resumen: ResumenVentasClientes }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi valor={String(resumen.ventas)} label="Ventas" />
        <Kpi valor={String(resumen.compradores)} label="Clientes" />
        <Kpi valor={UYU(resumen.totalVendido)} label="Vendido" />
        <Kpi valor={UYU(resumen.totalCobrado)} label="Cobrado" acento />
      </div>

      {ventas.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-borde bg-tarjeta p-6 text-center">
          <p className="text-[13px] font-bold text-tinta">Todavía ningún cliente compró en la tienda</p>
          <p className="mt-1 text-[12px] font-medium text-gris">Cuando conviertas un pedido en venta, la compra aparece acá.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {ventas.map((v) => {
            const pct = v.total > 0 ? Math.min(100, Math.round((v.pagado / v.total) * 100)) : 0;
            const e = ESTADO[v.estado] ?? { label: v.estado, bg: "#F1F3F9", fg: "#6B7494" };
            return (
              <li key={v.id} className="flex flex-col gap-2.5 rounded-[14px] border border-borde bg-tarjeta p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/admin/clientes/${v.clienteId}`} className="truncate text-[14px] font-bold text-azul hover:underline">
                      {v.clienteNombre ?? "Cliente"}
                    </Link>
                    <span className="truncate text-[12.5px] font-semibold text-cuerpo">{v.proveedor === "curbe" ? "💎 " : "🛒 "}{v.productoNombre}</span>
                    <span className="text-[11.5px] font-medium text-gris">Empezó el {fecha(v.fechaInicio)} · {v.totalDias} cuotas de {UYU(v.cuota)}</span>
                  </div>
                  <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: e.bg, color: e.fg }}>{e.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF1F8]">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-gris tabular-nums">{UYU(v.pagado)} / {UYU(v.total)}</span>
                </div>
                {v.falta > 0 && v.estado === "activo" && (
                  <span className="text-[11.5px] font-semibold text-[#B9770E]">Falta {UYU(v.falta)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

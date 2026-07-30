// Panel del EMPLEADO en /tienda: sus compras a crédito con CUÁNDO empezó el crédito
// y el HISTORIAL de cuánto se le descontó cada vez (pedido de Carlos). Display-only.
import type { CompraEmpleado } from "@/lib/data/comprasEmpleado";

const UYU = (n: number) => "$" + Math.round(n).toLocaleString("es-UY");
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

export function MisComprasEmpleado({ compras }: { compras: CompraEmpleado[] }) {
  if (!compras || compras.length === 0) return null;
  const saldoTotal = compras.filter((c) => c.estado === "activa").reduce((a, c) => a + c.saldo, 0);

  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-[#E4EAF6] bg-white p-4 shadow-[0_2px_10px_rgba(15,27,61,0.05)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-extrabold text-tinta">🧾 Mis compras a crédito</span>
        {saldoTotal > 0 && (
          <span className="rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[11.5px] font-bold text-azul">Debés {UYU(saldoTotal)}</span>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {compras.map((c) => {
          const pagado = c.total - c.saldo;
          const pct = c.total > 0 ? Math.min(100, Math.round((pagado / c.total) * 100)) : 0;
          return (
            <li key={c.id} className="flex flex-col gap-2 rounded-[14px] border border-[#EEF1F8] bg-[#FBFCFF] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-bold text-tinta">{c.productoNombre}</span>
                  <span className="text-[11.5px] font-medium text-gris">Empezó el {fecha(c.creadaEn)} · {c.cuotas} cuotas de {UYU(c.cuotaMonto)}</span>
                </div>
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    c.estado === "saldada" ? "bg-[#E4F5EC] text-[#157A50]" : c.estado === "cancelada" ? "bg-[#F1F3F9] text-gris" : "bg-[#FDF3E2] text-[#B9770E]"
                  }`}
                >
                  {c.estado === "saldada" ? "Saldada ✓" : c.estado === "cancelada" ? "Cancelada" : `Debés ${UYU(c.saldo)}`}
                </span>
              </div>

              {/* Progreso pagado/total */}
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF1F8]">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] font-bold text-gris tabular-nums">{UYU(pagado)} / {UYU(c.total)}</span>
              </div>

              {/* Historial de descuentos: cuánto se descontó cada vez. */}
              {c.descuentos.length > 0 ? (
                <div className="flex flex-col gap-1 border-t border-[#EEF1F8] pt-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">Descuentos de comisión</span>
                  {c.descuentos.map((d, k) => (
                    <div key={k} className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-cuerpo">{fecha(d.creadoEn)}</span>
                      <span className="font-bold tabular-nums text-[#157A50]">−{UYU(d.monto)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                c.estado === "activa" && <span className="text-[11px] font-medium text-tenue">Todavía sin descuentos. Se descuenta al liquidar tu comisión.</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

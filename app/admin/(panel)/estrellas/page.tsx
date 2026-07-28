// Estrellas (admin): canjes de estrellas por aprobar. Los fragmentos se derivan
// de los pagos reales (1 pago = 1 fragmento; 5 = 1 estrella); acá el gestor
// aprueba/rechaza las solicitudes de canje. El premio lo entrega la oficina.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRedencionesPendientes, getHistorialRedenciones } from "@/lib/data/estrellas";
import { RedencionesManager } from "@/components/admin/RedencionesManager";
import { RedimirEstrellas } from "@/components/admin/RedimirEstrellas";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";
import { meses } from "@/lib/format";

export const dynamic = "force-dynamic";

function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default async function EstrellasPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [pendientes, historial] = await Promise.all([
    getRedencionesPendientes(db),
    getHistorialRedenciones(db, 40),
  ]);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Estrellas</h1>
          <span className="text-[13px] font-medium text-gris">
            Canjes por aprobar. Cada 5 pagos, el cliente gana una estrella; puede canjear hasta
            5 por mes. Al aprobar, entregás el premio.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" nota="el canje desde la app del cliente está en pausa" />
      </div>

      {/* Redención directa del admin (en persona). */}
      <RedimirEstrellas />

      {pendientes.length > 0 && (
        <span className="text-[12px] font-bold tracking-wide text-gris uppercase">
          Solicitudes pendientes ({pendientes.length})
        </span>
      )}
      <RedencionesManager pendientes={pendientes} />

      {/* Historial de canjes resueltos. */}
      <section className="flex flex-col gap-2 rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[14px] font-extrabold text-tinta">Historial de canjes</span>
        {historial.length === 0 ? (
          <p className="py-3 text-center text-[12.5px] font-medium text-gris">
            Todavía no hay canjes resueltos.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-linea">
            {historial.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2">
                <span
                  className="flex h-8 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-[12px] font-black"
                  style={
                    h.estado === "aprobada"
                      ? { background: "#E4F5EC", color: "#157A50" }
                      : { background: "#FBE4E2", color: "#C0392B" }
                  }
                >
                  {h.estrellas}⭐
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-bold text-tinta">{h.clienteNombre}</span>
                  <span className="text-[11px] font-medium text-tenue">
                    {h.estado === "aprobada" ? "Aprobado" : "Rechazado"}
                    {h.resueltoPorNombre ? ` por ${h.resueltoPorNombre}` : ""} · {fechaHora(h.resueltoEn)}
                  </span>
                </div>
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    h.estado === "aprobada" ? "bg-[#E7F6EF] text-[#157A50]" : "bg-[#FCE8E8] text-[#C0392B]"
                  }`}
                >
                  {h.estado === "aprobada" ? "Canjeada" : "Rechazada"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Las estrellas se calculan solas a partir de los pagos reales (no se pueden “trucar”): si un
        pago se anula, su fragmento desaparece. Requiere la migración 0020.
      </p>
    </div>
  );
}

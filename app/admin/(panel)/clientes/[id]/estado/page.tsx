// Estado de cuenta de un cliente, listo para IMPRIMIR o guardar como PDF.
// Solo gestores. El botón imprimir usa window.print(); el chrome del panel se
// oculta al imprimir (print:hidden en el layout). Documento formal con el
// detalle de cada cuota y su estado + resumen. Solo lectura.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getFichaCliente } from "@/lib/data/ficha";
import { NEGOCIO } from "@/lib/negocio";
import { UYU, meses } from "@/lib/format";
import { BotonImprimir } from "@/components/admin/BotonImprimir";
import type { EstadoDia } from "@/types/cartones";

export const dynamic = "force-dynamic";

const ESTADO: Record<EstadoDia, { label: string; bg: string; fg: string }> = {
  pagado: { label: "Pagado", bg: "#E4F5EC", fg: "#157A50" },
  pendiente: { label: "Parcial", bg: "#FDF3E2", fg: "#B9770E" },
  atrasado: { label: "Atrasado", bg: "#FBE4E2", fg: "#C0392B" },
  futuro: { label: "Futuro", bg: "#F1F3F9", fg: "#8A93AD" },
};

function fechaLarga(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function emisionUY(): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

export default async function EstadoCuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireGestor();
  const db = await createSupabaseServer();
  const ficha = await getFichaCliente(db, id);
  if (!ficha) notFound();

  const { cliente, activo, creditos } = ficha;
  const creditoActivo = creditos.find((c) => c.estado === "activo") ?? null;
  const totalAPagar = activo ? activo.cuota * activo.totalDias : 0;
  const pagado = activo ? totalAPagar - activo.saldo : 0;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
      {/* Barra de acciones (no se imprime) */}
      <div className="print:hidden flex items-center justify-between gap-3">
        <Link
          href={`/admin/clientes/${id}`}
          className="text-[13px] font-bold text-azul hover:underline"
        >
          ← Volver a la ficha
        </Link>
        <BotonImprimir />
      </div>

      {/* Documento */}
      <div className="rounded-[16px] border border-[#E6EAF4] bg-white p-6 print:rounded-none print:border-0 print:p-0">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E6EAF4] pb-4">
          <div className="flex flex-col">
            <span className="text-[20px] font-black tracking-[-0.02em] text-tinta">
              {NEGOCIO.nombre}
            </span>
            <span className="text-[12px] font-medium text-gris">{NEGOCIO.direccion}</span>
            <span className="text-[12px] font-medium text-gris">Tel. {NEGOCIO.telefono}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[15px] font-extrabold text-tinta">Estado de cuenta</span>
            <span className="text-[11.5px] font-medium text-gris">Emitido: {emisionUY()}</span>
          </div>
        </div>

        {/* Cliente */}
        <div className="grid gap-3 py-4 sm:grid-cols-2">
          <Campo label="Cliente" valor={cliente.nombre} />
          <Campo label="Documento" valor={cliente.documento ?? "—"} />
          <Campo label="Teléfono" valor={cliente.telefono ?? "—"} />
          <Campo label="Dirección" valor={cliente.direccion ?? "—"} />
        </div>

        {!activo || !creditoActivo ? (
          <p className="rounded-[12px] bg-[#F7F9FD] px-4 py-6 text-center text-[13px] font-medium text-gris">
            Este cliente no tiene un crédito activo.
          </p>
        ) : (
          <>
            {/* Resumen del crédito */}
            <div className="grid grid-cols-2 gap-3 rounded-[12px] bg-[#F7F9FD] p-4 sm:grid-cols-4 print:bg-white print:border print:border-[#E6EAF4]">
              <Dato label="Prestado" valor={UYU(creditoActivo.monto)} />
              <Dato label="Cuota" valor={UYU(activo.cuota)} />
              <Dato label="Total a pagar" valor={UYU(totalAPagar)} />
              <Dato label="Pagado" valor={UYU(pagado)} />
              <Dato label="Saldo" valor={UYU(activo.saldo)} destacar />
              <Dato label="Avance" valor={`${activo.progresoPct}%`} />
              <Dato label="Cuotas" valor={`${activo.pagados}/${activo.totalDias}`} />
              <Dato
                label="Días atrasados"
                valor={String(activo.diasAtraso)}
                alerta={activo.diasAtraso > 0}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px] font-medium text-gris">
              <span>Inicio: {fechaLarga(creditoActivo.fechaInicio)}</span>
              {activo.proximaFecha && <span>Próxima cuota: {fechaLarga(activo.proximaFecha)}</span>}
            </div>

            {/* Detalle de cuotas */}
            <div className="mt-5">
              <span className="text-[13px] font-extrabold text-tinta">Detalle de cuotas</span>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#E6EAF4] text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">Fecha</th>
                      <th className="py-2 pr-2 text-right">Cuota</th>
                      <th className="py-2 pr-2 text-right">Pagado</th>
                      <th className="py-2 pl-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {activo.dias.map((d) => {
                      const e = ESTADO[d.estado];
                      return (
                        <tr key={d.dia} className="border-b border-[#F1F3F9]">
                          <td className="py-1.5 pr-2 text-gris">{d.dia}</td>
                          <td className="py-1.5 pr-2">{fechaLarga(d.fecha)}</td>
                          <td className="py-1.5 pr-2 text-right">{UYU(activo.cuota)}</td>
                          <td className="py-1.5 pr-2 text-right">
                            {d.montoPagado > 0 ? UYU(d.montoPagado) : "—"}
                          </td>
                          <td className="py-1.5 pl-2">
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                              style={{ background: e.bg, color: e.fg }}
                            >
                              {e.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <p className="mt-5 border-t border-[#E6EAF4] pt-3 text-[10.5px] leading-[1.6] text-[#8A93AD]">
          Documento informativo generado por {NEGOCIO.nombre}. Los montos están en pesos
          uruguayos. El libro de pagos es la fuente oficial; ante cualquier diferencia,
          consultá en la oficina.
        </p>
      </div>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span className="text-[13.5px] font-semibold text-tinta">{valor}</span>
    </div>
  );
}

function Dato({
  label,
  valor,
  destacar,
  alerta,
}: {
  label: string;
  valor: string;
  destacar?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span
        className={`text-[15px] font-extrabold tabular-nums ${
          alerta ? "text-[#C0392B]" : destacar ? "text-azul" : "text-tinta"
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

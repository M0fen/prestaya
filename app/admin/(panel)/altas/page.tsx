// ALTAS EN LA APP. Avance de la entrega del cartón a los clientes, por cobrador.
// Los clientes entran a su cartón con un link personal (QR / WhatsApp) que les
// da el cobrador en la calle: acá se ve cuánto de esa campaña está hecho.
// El supervisor lo ve acotado a su zona; el admin, todo.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { getResumenAltas, type FilaAltas } from "@/lib/data/acceso";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

const TOPE_MS = 22_000;

export default async function AltasAdminPage() {
  await requireGestor();
  const { migracionPendiente, filas, totales } = await conTimeout(
    getResumenAltas(),
    TOPE_MS,
    "admin.altas",
  );

  const pct = totales.total > 0 ? Math.round((totales.activos / totales.total) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Altas en la app</h1>
        <span className="text-[13px] font-medium text-gris">
          Cada cliente entra a su cartón con un código QR propio que le muestra el cobrador. Acá
          seguís cuántos ya lo están usando.
        </span>
      </div>

      {migracionPendiente ? (
        <p className="rounded-[14px] border border-[#F0E3C8] bg-[#FDF8EC] px-4 py-3 text-[13px] font-medium text-[#7A5B10]">
          Falta correr la migración <b>0084</b> en el SQL Editor. Los cobradores ya pueden entregar
          el QR igual; el avance se empieza a medir apenas corras la migración.
        </p>
      ) : totales.total === 0 ? (
        <p className="rounded-[14px] border border-borde bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          No hay clientes asignados en tu alcance.
        </p>
      ) : (
        <>
          {/* Avance general */}
          <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[11.5px] font-semibold tracking-wide text-tenue uppercase">
                  Clientes usando su cartón
                </span>
                <span className="text-[28px] leading-tight font-black text-tinta tabular-nums">
                  {totales.activos}
                  <span className="text-[16px] font-bold text-tenue">/{totales.total}</span>
                </span>
              </div>
              <div className="flex gap-2">
                <Chip label="Sin entregar" valor={totales.pendientes} bg="#F3F5FB" fg="#6B7494" />
                <Chip label="Entregados sin abrir" valor={totales.entregados} bg="#EAF0FF" fg="#1E47C8" />
                <Chip label="Activos" valor={totales.activos} bg="#E4F5EC" fg="#157A50" />
                {/* Fuera del denominador (0131): no son trabajo pendiente, pero
                    son un dato de negocio — cuántos clientes no alcanza la app. */}
                {totales.noAplica > 0 && (
                  <Chip label="No usan la app" valor={totales.noAplica} bg="#F3F5FB" fg="#6B7494" />
                )}
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#EEF1F8]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </section>

          {/* Por cobrador — primero los que más pendientes tienen (a quién empujar). */}
          <section className="overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            <div className="border-b border-borde px-4 py-3">
              <span className="text-[13px] font-bold text-tinta">Por cobrador</span>
            </div>
            <ul className="divide-y divide-[#EEF1F8]">
              {filas.map((f) => (
                <li key={f.cobradorId}>
                  <FilaCobrador fila={f} />
                </li>
              ))}
            </ul>
          </section>

          <p className="text-[11.5px] font-medium text-tenue">
            &ldquo;Activo&rdquo; significa que el cliente <b>abrió su cartón al menos una vez</b>: es la
            única prueba real de que el link le llegó. El QR de cada cliente está en su ficha
            (<Link href="/admin/clientes" className="font-bold text-azul">Clientes</Link>).
          </p>
        </>
      )}
    </div>
  );
}

function FilaCobrador({ fila }: { fila: FilaAltas }) {
  const pct = fila.total > 0 ? Math.round((fila.activos / fila.total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-bold text-tinta">{fila.cobradorNombre}</span>
          <span className="flex-shrink-0 text-[12px] font-bold text-gris tabular-nums">
            {fila.activos}/{fila.total}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#EEF1F8]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span
        className={`w-[104px] flex-shrink-0 rounded-full px-2.5 py-1 text-center text-[11.5px] font-bold tabular-nums ${
          fila.pendientes > 0 ? "bg-[#FDF3E2] text-[#9A6A0E]" : "bg-[#E4F5EC] text-[#157A50]"
        }`}
      >
        {fila.pendientes > 0 ? `${fila.pendientes} sin entregar` : "Todos entregados"}
      </span>
    </div>
  );
}

function Chip({ label, valor, bg, fg }: { label: string; valor: number; bg: string; fg: string }) {
  return (
    <div className="flex flex-col items-center rounded-[11px] px-3 py-1.5" style={{ background: bg }}>
      <span className="text-[15px] font-black tabular-nums" style={{ color: fg }}>
        {valor}
      </span>
      <span className="text-[10px] font-bold" style={{ color: fg }}>
        {label}
      </span>
    </div>
  );
}

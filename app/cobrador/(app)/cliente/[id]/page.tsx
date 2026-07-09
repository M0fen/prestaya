// Detalle del cliente para el cobrador: cartón REAL (calcularEstadosCarton) +
// resumen + registro de cobro/no pago con GPS y geo-cerca. Lectura por RLS.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { requireUsuario, esGestor } from "@/lib/auth";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { getNotasCliente } from "@/lib/data/notas";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import type { EstadoDia } from "@/types/cartones";
import type { Prestamo } from "@/types/db";
import { UYU } from "@/lib/format";
import { RegistroCobro } from "@/components/cobrador/RegistroCobro";
import { BeaconFicha } from "@/components/cobrador/BeaconFicha";
import { NotasCliente } from "@/components/notas/NotasCliente";

export const dynamic = "force-dynamic";

const COLOR: Record<EstadoDia, string> = {
  pagado: "#1FA971",
  pendiente: "#E8A317",
  atrasado: "#E06A6A",
  futuro: "#EEF1F8",
};

export default async function DetalleClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ credito?: string }>;
}) {
  const { id } = await params;
  const { credito } = await searchParams;
  const db = await createSupabaseServer();
  const usuario = await requireUsuario();

  const cliente = await getClientePorId(db, id);
  if (!cliente) notFound();

  // Un cliente puede tener VARIOS créditos activos (0037). El cobrador elige a
  // cuál imputa; por defecto, el principal (el más nuevo).
  const activos = await getPrestamosActivosPorCliente(db, id);
  const prestamo = activos.find((p) => p.id === credito) ?? activos[0] ?? null;
  const notas = await getNotasCliente(db, id);
  // Inicial del avatar con fallback: un cliente importado sin nombre no debe
  // tumbar la ficha (charAt sobre null/undefined tira). "—" si no hay letra.
  const inicial = (cliente.nombre ?? "").trim().charAt(0).toUpperCase() || "—";

  return (
    <div className="flex flex-col gap-4">
      {/* Bitácora: registra que el cobrador abrió esta ficha, con GPS. */}
      {!esGestor(usuario.rol) && <BeaconFicha clienteId={id} />}
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Ruta
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#2453DC] text-[22px] font-black text-white">
          {inicial}
        </div>
        <div className="flex flex-col">
          <span className="text-[19px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="text-[12.5px] font-medium text-gris">
            {cliente.direccion ?? "Sin dirección"}
          </span>
        </div>
      </div>

      {/* Selector de crédito: solo si el cliente tiene MÁS DE UNO activo. */}
      {activos.length > 1 && prestamo && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-gris">
            {activos.length} créditos activos — elegí a cuál imputás:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {activos.map((p, i) => {
              const activo = p.id === prestamo.id;
              return (
                <Link
                  key={p.id}
                  href={`/cobrador/cliente/${id}?credito=${p.id}`}
                  scroll={false}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
                    activo
                      ? "bg-[#1E47C8] text-white"
                      : "border border-[#DCE3F4] bg-white text-[#6B7494]"
                  }`}
                >
                  Crédito {i + 1} · {UYU(p.cuota_diaria)}/día
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!prestamo ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Este cliente no tiene un crédito activo. El alta de créditos la hace la
          oficina.
        </p>
      ) : (
        <Detalle
          db={db}
          clienteId={id}
          cliente={cliente}
          prestamo={prestamo}
          cobradorNombre={usuario.nombre}
        />
      )}

      <NotasCliente
        clienteId={id}
        notas={notas}
        yoId={usuario.id}
        puedeGestionar={esGestor(usuario.rol)}
      />
    </div>
  );
}

async function Detalle({
  db,
  clienteId,
  cliente,
  prestamo,
  cobradorNombre,
}: {
  db: Awaited<ReturnType<typeof createSupabaseServer>>;
  clienteId: string;
  cliente: Awaited<ReturnType<typeof getClientePorId>>;
  prestamo: Prestamo;
  cobradorNombre: string;
}) {
  const pagos = await getPagosDePrestamo(db, prestamo.id);
  const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
  const cubiertos = r.dias.filter((d) => d.estado === "pagado").length;
  const tieneGps = Boolean(cliente?.gps_lat != null && cliente?.gps_lng != null);

  return (
    <>
      {/* Resumen */}
      <div className="grid grid-cols-2 gap-2.5">
        <Resumen label="Cuota diaria" valor={UYU(prestamo.cuota_diaria)} />
        <Resumen label="Saldo" valor={UYU(r.falta)} />
        <Resumen label="Días cubiertos" valor={`${cubiertos}/${prestamo.total_dias}`} />
        <Resumen label="Total" valor={UYU(r.totalAPagar)} />
      </div>

      {/* Cartón real */}
      <div className="rounded-[16px] bg-[#F1E8D2] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11.5px] font-bold text-[#8A6D1E]">Cartón</span>
          <span className="text-[11px] font-medium text-[#a98b3e]">
            {r.progresoPct}% pagado
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {r.dias.map((d) => (
            <div
              key={d.dia}
              className="flex aspect-square items-center justify-center rounded-[9px] text-[11px] font-bold"
              style={{
                background: COLOR[d.estado],
                color: d.estado === "futuro" ? "#B3A488" : "#fff",
                boxShadow: d.esHoy ? "0 0 0 2px #13308C" : "none",
              }}
            >
              {d.estado === "pagado" ? "✓" : d.dia}
            </div>
          ))}
        </div>
      </div>

      <RegistroCobro
        clienteId={clienteId}
        prestamoId={prestamo.id}
        clienteNombre={cliente?.nombre ?? ""}
        clienteTelefono={cliente?.telefono ?? null}
        cobradorNombre={cobradorNombre}
        cuota={prestamo.cuota_diaria}
        saldoActual={r.falta}
        tieneGps={tieneGps}
      />
    </>
  );
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[18px] font-extrabold text-tinta tabular-nums">{valor}</span>
    </div>
  );
}

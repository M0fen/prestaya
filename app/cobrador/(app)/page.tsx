// Ruta del día del cobrador: arqueo + lista de clientes asignados con su
// estado de hoy. Lee por RLS (solo los suyos). Tocar un cliente → detalle.
// La lista puede reordenarse por cercanía (client-side, ver ListaRuta).
import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRutaCobrador } from "@/lib/data/ruta";
import { getEstadoJornada } from "@/lib/data/rendicion";
import { getGastosCobradorHoy } from "@/lib/data/gastos";
import { getUsuarioActual } from "@/lib/auth";
import { UYU } from "@/lib/format";
import { ListaRuta, type ItemRutaVista } from "@/components/cobrador/ListaRuta";
import { GastosRuta } from "@/components/cobrador/GastosRuta";
import { CerrarJornada } from "@/components/cobrador/CerrarJornada";

export const dynamic = "force-dynamic";

export default async function RutaPage() {
  const db = await createSupabaseServer();
  const { items, arqueo } = await getRutaCobrador(db);
  const usuario = await getUsuarioActual();
  const jornada = usuario ? await getEstadoJornada(db, usuario.id) : null;
  const gastos = usuario ? await getGastosCobradorHoy(db, usuario.id) : null;

  const vista: ItemRutaVista[] = items.map((i) => ({
    id: i.cliente.id,
    nombre: i.cliente.nombre,
    direccion: i.cliente.direccion,
    cuota: i.cuota,
    estadoHoy: i.estadoHoy,
    pagadoHoy: i.pagadoHoy,
    lat: i.cliente.gps_lat,
    lng: i.cliente.gps_lng,
  }));

  // Avance de la ruta: clientes "resueltos" hoy (cobrados + no-pago) sobre el
  // total con crédito. El abono parcial NO cuenta como resuelto (falta cubrir).
  const resueltos = arqueo.cobrados + arqueo.noPagos;
  const avancePct = arqueo.clientes > 0 ? Math.round((resueltos / arqueo.clientes) * 100) : 0;
  const cobroPct = arqueo.esperado > 0 ? Math.min(100, Math.round((arqueo.recaudado / arqueo.esperado) * 100)) : 0;
  const faltanVisitas = Math.max(0, arqueo.clientes - resueltos);

  return (
    <div className="flex flex-col gap-4">
      {/* Arqueo del día */}
      <section className="rounded-[18px] bg-[linear-gradient(155deg,#173063_0%,#0F1B3D_60%)] p-4 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
        <div className="mb-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">
              Recaudado hoy
            </span>
            <span className="text-[27px] leading-tight font-black tabular-nums">
              {UYU(arqueo.recaudado)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[12px] font-bold text-white/80 tabular-nums">{cobroPct}%</span>
            <span className="text-[11px] font-medium text-white/50">de {UYU(arqueo.esperado)}</span>
          </div>
        </div>
        {/* Progreso de cobro (recaudado / esperado). */}
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]"
            style={{ width: `${cobroPct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Mini label="Cobrados" valor={`${arqueo.cobrados}/${arqueo.clientes}`} />
          <Mini label="Abonos" valor={String(arqueo.abonos)} tono={arqueo.abonos > 0 ? "#F2C14E" : undefined} />
          <Mini label="Pendientes" valor={String(arqueo.pendientes)} />
          <Mini label="No pago" valor={String(arqueo.noPagos)} tono={arqueo.noPagos > 0 ? "#F0A0A0" : undefined} />
        </div>
      </section>

      <div className="flex items-center justify-between px-0.5">
        <div className="flex flex-col">
          <h1 className="text-[16px] font-extrabold text-tinta">Mi ruta de hoy</h1>
          {arqueo.clientes > 0 && (
            <span className="text-[11.5px] font-medium text-gris">
              {faltanVisitas > 0
                ? `Te faltan ${faltanVisitas} de ${arqueo.clientes} · ${avancePct}% de la ruta`
                : `Ruta completa 🎉 · ${arqueo.clientes} clientes`}
            </span>
          )}
        </div>
        <Link
          href="/cobrador/censar"
          className="rounded-full bg-[#EEF3FF] px-3.5 py-1.5 text-[12.5px] font-bold text-azul"
        >
          + Censar
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Todavía no tenés clientes asignados. Usá “+ Censar” para agregar.
        </p>
      ) : (
        <ListaRuta items={vista} />
      )}

      {/* Gastos de ruta del cobrador (egresos que bajan lo que entrega). */}
      {gastos && !jornada?.yaRendida && <GastosRuta gastos={gastos} />}

      {/* Cierre de jornada (rendición): esperado vs entregado. */}
      {jornada && (
        <CerrarJornada
          recaudado={jornada.recaudado}
          cobrosCantidad={jornada.cobrosCantidad}
          gastosHoy={jornada.gastosHoy}
          yaRendida={jornada.yaRendida}
          disponible={jornada.disponible}
        />
      )}
    </div>
  );
}

function Mini({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col rounded-[11px] bg-white/10 px-2.5 py-2">
      <span className="text-[10px] font-semibold text-white/50">{label}</span>
      <span className="text-[14px] font-extrabold tabular-nums" style={tono ? { color: tono } : undefined}>
        {valor}
      </span>
    </div>
  );
}

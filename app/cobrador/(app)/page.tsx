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
    lat: i.cliente.gps_lat,
    lng: i.cliente.gps_lng,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Arqueo del día */}
      <section className="rounded-[16px] bg-[#0F1B3D] p-4 text-white">
        <div className="mb-3 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-white/50 uppercase">
              Recaudado hoy
            </span>
            <span className="text-[24px] font-black tabular-nums">
              {UYU(arqueo.recaudado)}
            </span>
          </div>
          <span className="text-[12px] font-medium text-white/60">
            de {UYU(arqueo.esperado)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Mini label="Cobrados" valor={`${arqueo.cobrados}/${arqueo.clientes}`} />
          <Mini label="Pendientes" valor={String(arqueo.pendientes)} />
          <Mini label="No pago" valor={String(arqueo.noPagos)} />
        </div>
      </section>

      <div className="flex items-center justify-between px-0.5">
        <h1 className="text-[16px] font-extrabold text-tinta">Mi ruta de hoy</h1>
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

function Mini({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col rounded-[11px] bg-white/10 px-2.5 py-2">
      <span className="text-[10px] font-semibold text-white/50">{label}</span>
      <span className="text-[14px] font-extrabold tabular-nums">{valor}</span>
    </div>
  );
}

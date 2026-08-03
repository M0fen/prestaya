// Tienda del cliente — página DEDICADA (se llega desde el botón "Ir a la tienda"
// del cartón). Como una extensión de Presta Ya: catálogo de electrodomésticos en
// cuotas. Valida el token en el servidor (service_role); solo lectura + el lead.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { getProductosParaCliente, getComprasTiendaDeCliente } from "@/lib/data/tienda";
import { conTimeout } from "@/lib/timeout";
import { TiendaCliente } from "@/components/tienda/TiendaCliente";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export default async function TiendaClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ producto?: string }>;
}) {
  const { token } = await params;
  const { producto } = await searchParams;
  const db = createSupabaseAdmin();
  const cliente = await conTimeout(getClientePorToken(db, token), TOPE_MS, "cliente.tienda.token");
  if (!cliente) notFound();
  const [productos, comprasTienda] = await Promise.all([
    conTimeout(getProductosParaCliente(db, cliente), TOPE_MS, "cliente.tienda"),
    getComprasTiendaDeCliente(db, cliente.id).catch(() => []),
  ]);
  const primerNombre = cliente.nombre.split(" ")[0];

  return (
    <div className="flex min-h-screen justify-center overflow-x-clip bg-fondo text-tinta">
      <div className="flex w-full max-w-[440px] flex-col gap-3 bg-[#EBEEF5] px-[18px] pt-0 pb-10 shadow-[0_0_60px_rgba(15,27,61,0.08)]">
        {productos.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-12 text-center">
            <span className="text-[40px]" aria-hidden="true">🛒</span>
            <p className="text-[15px] font-bold text-tinta">Pronto vas a ver productos acá</p>
            <p className="max-w-[280px] text-[13px] font-medium text-gris">Estamos preparando el catálogo. Volvé en unos días.</p>
            <Link href={`/c/${token}`} className="mt-2 rounded-full bg-[#1E47C8] px-5 py-2.5 text-[14px] font-bold text-white">Volver a mi cuenta</Link>
          </div>
        ) : (
          <TiendaCliente productos={productos} token={token} conEncabezado={false} abrirId={producto ?? null}
            compras={comprasTienda} perfilTitulo={`Hola, ${primerNombre}`}
            previo={
              /* La identidad de la tienda la lleva la barra sticky del componente
                 (marca + buscador). Antes había ADEMÁS un bloque azul de marca justo
                 encima: dos cabeceras apiladas comiéndose media pantalla del cliente
                 antes de ver un solo producto. Queda solo el volver, que es lo único
                 que esta página necesita aportar. */
              <Link href={`/c/${token}`} className="flex w-fit items-center gap-1 py-1 text-[13.5px] font-bold text-azul">
                ← Volver a mi cuenta
              </Link>
            } />
        )}
      </div>
    </div>
  );
}

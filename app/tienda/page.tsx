// TIENDA PRESTA YA — PÚBLICA. Visible para CUALQUIERA (clientes, empleados,
// prospectos), sin login. Catálogo a precio base + "Me interesa" que pide contacto
// (lead público, tabla leads_publicos 0111). El middleware no protege esta ruta.
import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos } from "@/lib/data/tienda";
import { conTimeout } from "@/lib/timeout";
import { TiendaCliente } from "@/components/tienda/TiendaCliente";
import { NEGOCIO } from "@/lib/negocio";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export const metadata = {
  title: "Tienda Presta Ya — comprá en cuotas cómodas",
  description: "Electrodomésticos, tecnología y más, financiados en cuotas. Elegí lo que necesitás y te contactamos con tu plan de pago.",
};

export default async function TiendaPublicaPage({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string }>;
}) {
  const { producto } = await searchParams;
  const db = createSupabaseAdmin();
  const productos = await conTimeout(getProductosPublicos(db), TOPE_MS, "tienda.publica");

  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
      <div className="flex w-full max-w-[480px] flex-col gap-3 bg-app px-[18px] pt-4 pb-12 shadow-[0_0_60px_rgba(15,27,61,0.08)]">
        {/* Barra de marca */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[15px] font-black text-white">P</div>
            <span className="text-[15px] font-extrabold text-tinta">{NEGOCIO.nombre}</span>
          </div>
          <Link href="/ingresar" className="text-[12.5px] font-bold text-azul">Ingresar</Link>
        </div>

        {/* Hero de bienvenida */}
        <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#2453DC,#13308C)] px-5 py-5 text-white shadow-[0_12px_30px_rgba(19,48,140,0.3)]">
          <span className="text-[26px]" aria-hidden="true">🛍️</span>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight">Tienda Presta Ya</h1>
          <p className="mt-1 text-[13.5px] font-medium text-white/85">Llevate lo que necesitás y pagalo en <b className="text-white">cuotas cómodas</b>. Elegí un producto y te pasamos tu plan.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">🚚 Entrega a domicilio</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">💳 En cuotas</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">🛡️ Con garantía</span>
          </div>
        </div>

        {productos.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-12 text-center">
            <span className="text-[40px]" aria-hidden="true">🛒</span>
            <p className="text-[15px] font-bold text-tinta">Pronto vas a ver productos acá</p>
            <p className="max-w-[280px] text-[13px] font-medium text-gris">Estamos preparando el catálogo. Volvé en unos días.</p>
          </div>
        ) : (
          <TiendaCliente productos={productos} token={null} modoPublico conEncabezado={false} abrirId={producto ?? null} />
        )}

        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          {NEGOCIO.nombre} · Financiación en cuotas. Dejanos tu interés y te contactamos con el precio y el plan para vos.
        </p>
      </div>
    </div>
  );
}

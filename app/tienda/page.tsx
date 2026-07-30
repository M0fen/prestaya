// TIENDA PRESTA YA — PÚBLICA. Visible para CUALQUIERA (clientes, empleados,
// prospectos), sin login. Catálogo a precio base + "Me interesa" que pide contacto
// (lead público, tabla leads_publicos 0111). El middleware no protege esta ruta.
import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos } from "@/lib/data/tienda";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
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
  // Quién mira (si está logueado): solo el equipo tiene sesión → lo saludamos por
  // su nombre en vez de "Ingresar" (Carlos: "que aparezca el nombre del que accedió").
  const [productos, usuario] = await Promise.all([
    conTimeout(getProductosPublicos(db), TOPE_MS, "tienda.publica"),
    getUsuarioActual().catch(() => null),
  ]);
  const logueado = usuario && usuario.activo ? usuario : null;
  const primerNombre = logueado ? logueado.nombre.split(" ")[0] : "";

  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
      {/* Mobile: columna angosta (480). Desktop: se ensancha a una tienda de verdad. */}
      <div className="flex w-full max-w-[480px] flex-col gap-3 bg-app px-[18px] pt-4 pb-12 shadow-[0_0_60px_rgba(15,27,61,0.08)] md:max-w-[1120px] md:px-8 md:pt-6">
        {/* Barra de marca */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[15px] font-black text-white md:h-9 md:w-9 md:text-[17px]">P</div>
            <span className="text-[15px] font-extrabold text-tinta md:text-[17px]">{NEGOCIO.nombre}</span>
          </div>
          {logueado ? (
            <Link href={rutaHome(logueado.rol)} className="flex items-center gap-1.5 rounded-full border border-[#DCE3F4] bg-white px-2 py-1 pr-3 text-[12.5px] font-bold text-azul hover:bg-suave">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[10.5px] font-black text-white">
                {logueado.nombre.slice(0, 1).toUpperCase()}
              </span>
              Hola, {primerNombre}
            </Link>
          ) : (
            <Link href="/ingresar" className="rounded-full border border-[#DCE3F4] bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-azul hover:bg-suave">Ingresar</Link>
          )}
        </div>

        {/* Hero de bienvenida */}
        <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#2453DC,#13308C)] px-5 py-5 text-white shadow-[0_12px_30px_rgba(19,48,140,0.3)] md:px-8 md:py-8">
          <span className="text-[26px] md:text-[32px]" aria-hidden="true">🛍️</span>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight md:text-[30px]">Tienda Presta Ya</h1>
          <p className="mt-1 max-w-[560px] text-[13.5px] font-medium text-white/85 md:text-[15px]">Llevate lo que necesitás y pagalo en <b className="text-white">cuotas cómodas</b>. Elegí un producto y te pasamos tu plan.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold md:text-[12.5px]">🚚 Entrega a domicilio</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold md:text-[12.5px]">💳 En cuotas</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold md:text-[12.5px]">🛡️ Con garantía</span>
          </div>
        </div>

        {/* Atribución CURBE: las fragancias y joyas son de curbe.uy, con link al sitio. */}
        <a
          href="https://curbe.uy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-[16px] border border-[#E4DAF7] bg-[#F5F0FD] px-4 py-3 transition hover:brightness-[0.99]"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[22px]" aria-hidden="true">💎</span>
            <div className="flex flex-col">
              <span className="text-[13px] font-extrabold text-[#4A2E9E] md:text-[14px]">Fragancias &amp; joyas por Curbe</span>
              <span className="text-[11.5px] font-medium text-[#6D4AC7] md:text-[12.5px]">Perfumes inspirados y oro 18k italiano · curbe.uy</span>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-[#6D4AC7]">Ver curbe.uy →</span>
        </a>

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

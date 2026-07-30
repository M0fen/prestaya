// TIENDA PRESTA YA — PÚBLICA. Visible para CUALQUIERA (clientes, empleados,
// prospectos), sin login. Catálogo a precio base + "Me interesa" que pide contacto
// (lead público, tabla leads_publicos 0111). El middleware no protege esta ruta.
import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getProductosPublicos } from "@/lib/data/tienda";
import { getMisComprasEmpleado } from "@/lib/data/comprasEmpleado";
import { getUsuarioActual, rutaHome } from "@/lib/auth";
import { conTimeout } from "@/lib/timeout";
import { TiendaCliente } from "@/components/tienda/TiendaCliente";
import { MisComprasEmpleado } from "@/components/tienda/MisComprasEmpleado";
import { HeroCarrusel, type HeroSlide } from "@/components/tienda/HeroCarrusel";
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
  // Empleado (cobrador/supervisor) logueado → compra a crédito (0113) + ve sus compras.
  const esEmpleado = !!logueado && (logueado.rol === "cobrador" || logueado.rol === "supervisor");
  const misCompras = esEmpleado ? await getMisComprasEmpleado(db, logueado!.id).catch(() => []) : [];

  // CARRUSEL del hero: la tienda es GENERAL (no solo perfumes) → un banner de Presta
  // Ya + un banner de Curbe, cada uno con SU imagen coherente (nunca "perfumes" con
  // foto de heladera). El banner de Curbe doblega como pieza publicitaria.
  const curbePerfume = productos.find((p) => p.proveedor === "curbe" && p.categoriaNombre !== "Oro 18k" && p.fotos[0]);
  const electro = productos.find((p) => !p.proveedor && p.fotos[0]);
  const slidesHero: HeroSlide[] = [
    {
      tema: "prestaya",
      eyebrow: "Tu tienda en cuotas",
      titulo: "Todo lo que necesitás, en cuotas cómodas.",
      acento: "en cuotas cómodas",
      sub: "Electrodomésticos, tecnología, fragancias y mucho más. Elegís, te pasamos el plan y te lo llevamos a tu casa.",
      img: electro?.fotos[0] ?? curbePerfume?.fotos[0] ?? null,
      imgLabel: electro?.nombre ?? curbePerfume?.nombre ?? null,
      cta: { label: "Ver productos ↓", href: "#catalogo" },
    },
    {
      tema: "curbe",
      eyebrow: "Perfumería & joyería · por Curbe",
      titulo: "Perfumes de autor y oro 18k.",
      acento: "oro 18k",
      sub: "Fragancias inspiradas en las grandes marcas y joyas de oro italiano 18k, en cuotas cómodas.",
      img: curbePerfume?.fotos[0] ?? null,
      imgLabel: curbePerfume?.nombre ?? null,
      cta: { label: "Ver curbe.uy →", href: "https://curbe.uy" },
    },
  ];

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

        {/* Hero = CARRUSEL de banners (Presta Ya general + Curbe publicitario). */}
        <HeroCarrusel slides={slidesHero} />

        {/* Ticker de beneficios con movimiento sutil (como los e-commerce top). */}
        <div className="tienda-ticker relative overflow-hidden rounded-full border border-[#E4EAF6] bg-white py-2.5 shadow-[0_2px_10px_rgba(15,27,61,0.05)]">
          <div className="tienda-ticker-track flex w-max gap-8 whitespace-nowrap px-4 text-[12.5px] font-bold text-cuerpo">
            {[0, 1].map((k) => (
              <div key={k} className="flex gap-8" aria-hidden={k === 1}>
                <span>🚚 Entrega a domicilio</span>
                <span>💳 Cuotas cómodas</span>
                <span>🛡️ Con garantía</span>
                <span>🔒 Compra segura</span>
                <span>🤝 Te lo lleva tu cobrador</span>
                <span>💎 Perfumes y joyas por Curbe</span>
              </div>
            ))}
          </div>
          <style>{`
            .tienda-ticker-track{animation:tickerMove 28s linear infinite}
            .tienda-ticker:hover .tienda-ticker-track{animation-play-state:paused}
            @keyframes tickerMove{to{transform:translateX(-50%)}}
            @media (prefers-reduced-motion: reduce){.tienda-ticker-track{animation:none}}
          `}</style>
        </div>

        {/* Empleado logueado: sus compras a crédito (inicio + historial de descuentos). */}
        {esEmpleado && <MisComprasEmpleado compras={misCompras} />}

        {esEmpleado && (
          <div className="rounded-[12px] border border-[#D7EADD] bg-[#F1FAF4] px-4 py-2.5 text-center text-[12.5px] font-semibold text-[#157A50]">
            💚 Sos parte del equipo: podés comprar a crédito y se descuenta de tu comisión.
          </div>
        )}

        <div id="catalogo" className="scroll-mt-4" />
        {productos.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-12 text-center">
            <span className="text-[40px]" aria-hidden="true">🛒</span>
            <p className="text-[15px] font-bold text-tinta">Pronto vas a ver productos acá</p>
            <p className="max-w-[280px] text-[13px] font-medium text-gris">Estamos preparando el catálogo. Volvé en unos días.</p>
          </div>
        ) : (
          <TiendaCliente productos={productos} token={null} modoPublico modoEmpleado={esEmpleado} conEncabezado={false} abrirId={producto ?? null} />
        )}

        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          {NEGOCIO.nombre} · Financiación en cuotas. Dejanos tu interés y te contactamos con el precio y el plan para vos.
        </p>
      </div>
    </div>
  );
}

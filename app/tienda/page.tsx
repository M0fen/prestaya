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
import { UYU } from "@/lib/format";
import { calcularPlanVenta } from "@/lib/venta";
import { NEGOCIO } from "@/lib/negocio";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

// Banner OG generado (Higgsfield 16-08, bucket tienda/og): compartir /tienda
// por WhatsApp ahora muestra tarjeta con imagen, como cualquier e-commerce.
const OG_TIENDA = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/tienda/og/og-tienda.png?width=1200&quality=80`;
export const metadata = {
  title: "Tienda Presta Ya — comprá en cuotas cómodas",
  description: "Electrodomésticos, tecnología y más, financiados en cuotas. Elegí lo que necesitás y te contactamos con tu plan de pago.",
  openGraph: {
    title: "Tienda Presta Ya",
    description: "Electrodomésticos, tecnología, fragancias y más — en cuotas cómodas, con entrega a domicilio.",
    images: [{ url: OG_TIENDA, width: 1200, height: 670 }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: [OG_TIENDA] },
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
  // "Mis compras" del perfil según el ingreso: el EMPLEADO ve sus compras a crédito.
  const comprasPerfil = esEmpleado
    ? misCompras.map((c) => ({ id: c.id, nombre: c.productoNombre, foto: null, total: c.total, saldo: c.saldo, cuota: c.cuotaMonto, cuotas: c.cuotas, estado: c.estado, fechaIso: c.creadaEn }))
    : [];

  // CARRUSEL del hero: la tienda es GENERAL (no solo perfumes) → un banner de Presta
  // Ya + un banner de Curbe, cada uno con SU imagen coherente (nunca "perfumes" con
  // foto de heladera). El banner de Curbe doblega como pieza publicitaria.
  const curbePerfume = productos.find((p) => p.proveedor === "curbe" && p.categoriaNombre !== "Oro 18k" && p.fotos[0]);
  const electro = productos.find((p) => !p.proveedor && p.fotos[0]);
  // Acompañantes del producto principal: dos fotos MÁS del mismo rubro (nunca la
  // del principal repetida). Es lo que hace que el banner se lea como catálogo.
  const acompanan = (principal: typeof electro, curbe: boolean) =>
    productos
      .filter((p) => (curbe ? p.proveedor === "curbe" : !p.proveedor) && p.fotos[0] && p.id !== principal?.id)
      .slice(0, 2)
      .map((p) => p.fotos[0]!);
  // Etiqueta de precio flotante del hero (precio + cuota), como los tags de ML.
  const tagDe = (p?: typeof electro): HeroSlide["tag"] => {
    if (!p) return undefined;
    const cuota = p.cuotas > 0 ? calcularPlanVenta({ precio: p.precio, interesPct: p.interesPct, cuotas: p.cuotas }).cuota : 0;
    return { linea1: UYU(p.precio), linea2: cuota > 0 ? `${p.cuotas}× ${UYU(cuota)}` : undefined };
  };
  const slidesHero: HeroSlide[] = [
    {
      tema: "prestaya",
      eyebrow: "Tu tienda en cuotas",
      titulo: "Todo lo que necesitás, en cuotas cómodas.",
      acento: "en cuotas cómodas",
      sub: "Electrodomésticos, tecnología, fragancias y mucho más. Elegís, te pasamos el plan y te lo llevamos a tu casa.",
      img: electro?.fotos[0] ?? curbePerfume?.fotos[0] ?? null,
      imgLabel: electro?.nombre ?? curbePerfume?.nombre ?? null,
      imgsExtra: acompanan(electro ?? curbePerfume, false),
      pills: ["Hasta 12 cuotas", "Sin trámites"],
      tag: tagDe(electro ?? curbePerfume),
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
      imgsExtra: acompanan(curbePerfume, true),
      pills: ["Perfumes de autor", "Oro 18k italiano"],
      tag: tagDe(curbePerfume),
      cta: { label: "Ver curbe.uy →", href: "https://curbe.uy" },
    },
  ];

  return (
    // overflow-x-clip: la cabecera pinta su fondo a 100vw (ver BarraTienda) y sin
    // esto ese ancho completo puede generar un scroll horizontal de un par de píxeles.
    <div className="flex min-h-screen justify-center overflow-x-clip bg-fondo text-tinta">
      {/* Mobile: columna angosta (480). Desktop: se ensancha a una tienda de verdad. */}
      <div className="flex w-full max-w-[480px] flex-col gap-3 bg-[#EBEEF5] px-[18px] pt-0 pb-12 shadow-[0_0_60px_rgba(15,27,61,0.08)] md:max-w-[1240px] md:bg-transparent md:px-8 md:shadow-none">
        {productos.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-12 text-center">
            <span className="text-[40px]" aria-hidden="true">🛒</span>
            <p className="text-[15px] font-bold text-tinta">Pronto vas a ver productos acá</p>
            <p className="max-w-[280px] text-[13px] font-medium text-gris">Estamos preparando el catálogo. Volvé en unos días.</p>
          </div>
        ) : (
          <TiendaCliente productos={productos} token={null} modoPublico modoEmpleado={esEmpleado} conEncabezado={false} abrirId={producto ?? null}
            compras={comprasPerfil} perfilTitulo={logueado ? `Hola, ${primerNombre}` : "Mi tienda"} conHeroExterno
            slotHeader={
              logueado ? (
                <Link href={rutaHome(logueado.rol)} title={`Ir a mi panel (${logueado.nombre})`}
                  className="mr-1 hidden items-center gap-1.5 rounded-full bg-white/15 py-1.5 pl-1.5 pr-3 text-[12.5px] font-bold text-white ring-1 ring-white/25 hover:bg-white/25 sm:flex">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10.5px] font-black text-[#13308C]">
                    {logueado.nombre.slice(0, 1).toUpperCase()}
                  </span>
                  {primerNombre}
                </Link>
              ) : (
                <Link href="/ingresar" className="mr-1 hidden rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-bold text-white ring-1 ring-white/25 hover:bg-white/25 sm:block">
                  Ingresar
                </Link>
              )
            }
            previo={
              <>
                {/* Hero = CARRUSEL de banners (Presta Ya general + Curbe publicitario). */}
                <HeroCarrusel slides={slidesHero} />

                {/* UNA promesa concreta, no una marquesina de seis. La franja de
                    Mercado Libre dice un número ("envío gratis desde $60.000") y por
                    eso se cree; un carrusel de virtudes girando se lee como relleno y
                    la gente lo saltea. Acá el gancho real del negocio son las cuotas. */}
                <div className="flex items-center justify-center gap-2 rounded-[8px] bg-white px-4 py-2.5 text-center shadow-[0_1px_5px_rgba(15,27,61,0.06)]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#00A650" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0" aria-hidden>
                    <path d="M1 3h13v13H1zM14 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" />
                  </svg>
                  <span className="text-[12.5px] font-medium leading-tight text-cuerpo">
                    <b className="font-extrabold text-[#00A650]">Entrega a domicilio</b> y{" "}
                    <b className="font-extrabold text-tinta">cuotas a tu medida</b> en todo el catálogo.
                  </span>
                </div>

                {/* Empleado logueado: sus compras a crédito (inicio + historial). */}
                {esEmpleado && <MisComprasEmpleado compras={misCompras} />}
                {esEmpleado && (
                  <div className="rounded-[8px] border border-[#D7EADD] bg-[#F1FAF4] px-4 py-2.5 text-center text-[12.5px] font-semibold text-[#157A50]">
                    Sos parte del equipo: podés comprar a crédito y se descuenta de tu comisión.
                  </div>
                )}

                {/* Ancla del CTA del hero ("Ver productos ↓"): cae justo donde arranca
                    el catálogo, no antes de la cabecera. */}
                <div id="catalogo" className="scroll-mt-[104px]" />
              </>
            } />
        )}

        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          {NEGOCIO.nombre} · Financiación en cuotas. Dejanos tu interés y te contactamos con el precio y el plan para vos.
        </p>
      </div>
    </div>
  );
}

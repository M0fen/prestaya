// ─────────────────────────────────────────────────────────────────────────
//  Vista de cliente REAL — acceso por link con token, SIN login.
//
//  Patrón seguro (Paso 6): el servidor recibe el token, consulta Supabase con
//  la SERVICE_ROLE_KEY (solo servidor), valida que el token corresponda a un
//  cliente y devuelve ÚNICAMENTE los datos de ese cliente. El navegador nunca
//  habla directo con Supabase.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { marcarAccesoVisto } from "@/lib/data/acceso";
import {
  getPrestamosActivosPorCliente,
  contarCreditosPagados,
} from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { getAnunciosActivos } from "@/lib/data/anuncios";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getEstadoRaspaCliente, getQuinielaAbierta, getParticipacionCliente } from "@/lib/data/promos";
import { numeroSuerte } from "@/lib/quiniela";
import { calcularEstadosCarton } from "@/lib/cartones";
import { getRifaParaCliente, getParticipacionRifaCliente } from "@/lib/data/rifas";
import { construirVistaCliente } from "@/lib/vistaCliente";
import { hayProductosActivos, getProductoDestacadoParaCliente, type ProductoParaCliente } from "@/lib/data/tienda";
import { conTimeout } from "@/lib/timeout";
import { hoyUY } from "@/lib/fecha";
import type { Anuncio } from "@/types/db";
import type { ClienteSegmentable } from "@/lib/segmentos";
import { clienteEnSegmento } from "@/lib/segmentos";
import { NEGOCIO } from "@/lib/negocio";
import { VistaClienteScreen } from "@/components/VistaClienteScreen";
import { SinCreditoActivo } from "@/components/SinCreditoActivo";

// Siempre datos frescos y "hoy" real del servidor: nunca cachear ni prerenderizar.
export const dynamic = "force-dynamic";

// Enlaza el manifest POR CLIENTE (ver ./manifest.webmanifest/route.ts), que
// reemplaza al global: si el cliente instala la app desde acá, el ícono abre SU
// cartón y no el login del equipo. `manifest` es un campo escalar de metadata:
// el valor de la página pisa al del app/manifest.ts global → un solo <link>.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return {
    title: "Mi cartón — Presta Ya",
    manifest: `/c/${encodeURIComponent(token)}/manifest.webmanifest`,
  };
}

// Tope GENEROSO (22s) del camino crítico del cartón: un query lento lanza → lo toma
// el error.tsx del cliente (aviso tranquilo, sin alarma). Money-safe: LANZA, jamás
// muestra un $0/saldo falso. Una carga legítima ni lo roza.
const TOPE_MS = 22_000;

export default async function VistaPorToken({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ credito?: string }>;
}) {
  const { token } = await params;
  const { credito } = await searchParams;
  const db = createSupabaseAdmin();

  // 1) Validar el token → cliente. Si no existe, 404 (no revelamos nada).
  //    Camino crítico del cartón (cliente/activos/pagos) con tope de tiempo: un
  //    cuelgue lanza → lo toma el error.tsx del cliente (aviso tranquilo, sin
  //    alarma), en vez de dejar al adulto mayor mirando el spinner sin fin.
  const cliente = await conTimeout(getClientePorToken(db, token), TOPE_MS, "cliente.token");
  if (!cliente) notFound();

  // 1b) ALTA: sella la PRIMERA vez que el cliente abre su cartón — la única
  //     prueba real de que el link llegó (el cobrador ve "ya usa la app"). Un
  //     solo UPDATE en la vida del cliente y va DESPUÉS de responder (`after`):
  //     no le agrega ni un ms a la carga del cartón, y nunca la rompe.
  if (!cliente.acceso_visto_en) after(() => marcarAccesoVisto(db, cliente.id));

  // 2) Créditos activos del cliente (desde 0037 pueden ser varios). Se muestra
  //    el elegido (?credito=) o el principal; con un selector si hay más de uno.
  const activos = await conTimeout(
    getPrestamosActivosPorCliente(db, cliente.id),
    TOPE_MS,
    "cliente.activos",
  );
  const prestamo = activos.find((p) => p.id === credito) ?? activos[0] ?? null;
  if (!prestamo) {
    return <SinCreditoActivo nombre={cliente.nombre} negocio={NEGOCIO} />;
  }

  // Selector de crédito (solo si tiene más de uno activo). Amable, legible.
  const creditoSelector =
    activos.length > 1 ? (
      <div className="flex flex-col gap-1.5 rounded-[14px] bg-[#EEF3FF] px-3.5 py-3">
        <span className="text-[12.5px] font-semibold text-[#1E47C8]">
          Tenés {activos.length} créditos. Tocá para ver cada uno:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {activos.map((p, i) => {
            const sel = p.id === prestamo.id;
            return (
              <Link
                key={p.id}
                href={`/c/${token}?credito=${p.id}`}
                scroll={false}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${
                  sel ? "bg-[#1E47C8] text-white" : "bg-white text-[#1E47C8]"
                }`}
              >
                {p.origen === "tienda" ? `🛒 ${p.producto_nombre ?? "Tienda"}` : `Crédito ${i + 1}`}
              </Link>
            );
          })}
        </div>
      </div>
    ) : null;

  // 3) Pagos vigentes + cálculo + render. "hoy" = fecha real del servidor.
  const pagos = await conTimeout(getPagosDePrestamo(db, prestamo.id), TOPE_MS, "cliente.pagos");

  // Config de juegos del admin. Hoy solo se usa `ajustes.activo` para prender/
  // apagar la raspadita y la quiniela (el resto de la zona lúdica —arcade,
  // temporada, estrellas al cliente— está en pausa y no se muestra en el cartón).
  const ajustes = await getAjustesJuego(db);

  // Juegos promocionales (resiliente a que 0021 no exista).
  const [raspa, quiniela] = await Promise.all([
    getEstadoRaspaCliente(db, cliente.id),
    getQuinielaAbierta(db),
  ]);
  // Quiniela: el número es ASIGNADO (últimos 3 del número de registro). Participa
  // por estar AL DÍA (sin días atrasados; la cuota de hoy sin cobrar no descalifica).
  const participando = quiniela
    ? (await getParticipacionCliente(db, quiniela.id, cliente.id)) != null
    : false;
  const alDiaQuiniela = !calcularEstadosCarton(prestamo, pagos, hoyUY()).dias.some(
    (d) => d.estado === "atrasado",
  );
  // Vista del cliente (cartón). NO se muestra el cobrador al deudor: el comprobante
  // lleva hora + monto, sin nombre (evita la re-fuga si alguien reactivara `quien`).
  const v = construirVistaCliente({
    cliente,
    prestamo,
    pagos,
    negocio: NEGOCIO,
    hoy: hoyUY(),
  });

  // 4) AUDIENCIA del cliente (0089): calificación + zona del cobrador + estado. La
  //    usan anuncios, rifa y la QUINIELA para targetear por rango de personas. Se
  //    arma UNA vez (la zona del cobrador es una consulta barata). Resiliente: zona null.
  const alDiaAnuncio = v.estadoGeneral === "Estás al día";
  let zonaCliente: string | null = null;
  try {
    if (prestamo.cobrador_id) {
      const { data: cob } = await db
        .from("usuarios")
        .select("zona_id")
        .eq("id", prestamo.cobrador_id)
        .maybeSingle();
      zonaCliente = (cob as { zona_id: string | null } | null)?.zona_id ?? null;
    }
  } catch {
    zonaCliente = null;
  }
  const clienteSeg: ClienteSegmentable = {
    id: cliente.id,
    calificacion: cliente.calificacion,
    zonaId: zonaCliente,
    cobradorId: prestamo.cobrador_id ?? null,
    alDia: alDiaAnuncio,
  };

  // Los juegos (raspadita + quiniela) se muestran SOLO si la zona de juego está
  // activa (admin → /admin/juego). La quiniela además respeta su AUDIENCIA (0089):
  // si tiene segmento_def, solo participa/ve quien pertenece a ese rango de personas.
  const quinielaEnAudiencia = quiniela
    ? !quiniela.segmentoDef || clienteEnSegmento(clienteSeg, quiniela.segmentoDef)
    : false;
  // La raspadita también respeta su AUDIENCIA (0102): si está acotada a un segmento,
  // solo la ve quien pertenece. segmento_def NULL = todos.
  const raspaEnAudiencia = !ajustes.raspaSegmentoDef || clienteEnSegmento(clienteSeg, ajustes.raspaSegmentoDef);
  const promo = ajustes.activo
    ? {
        raspaDisponibles: raspaEnAudiencia ? raspa.disponibles : 0,
        quiniela: quiniela && quinielaEnAudiencia
          ? {
              id: quiniela.id,
              titulo: quiniela.titulo,
              premioTexto: quiniela.premioTexto,
              miNumero: numeroSuerte(cliente.numero_registro),
              alDia: alDiaQuiniela,
              participando,
            }
          : null,
      }
    : null;

  // Banner de anuncios — RESILIENTE: si algo falla, el crédito se muestra igual.
  let anuncios: Anuncio[] = [];
  try {
    anuncios = await getAnunciosActivos(db, clienteSeg);
  } catch {
    anuncios = [];
  }

  // 4b) Tienda: ¿hay productos activos? (chequeo barato para mostrar el botón "Ir a
  //     la tienda"; el catálogo se carga en la página aparte /c/[token]/tienda).
  //     Resiliente: si falta 0076 o algo falla, no se muestra el botón.
  //     Si hay tienda, además traemos el DESTACADO (banner del cartón) con el
  //     precio resuelto para este cliente. Resiliente: nunca rompe la vista.
  let hayTienda = false;
  let productoDestacado: ProductoParaCliente | null = null;
  try {
    hayTienda = await hayProductosActivos(db);
    if (hayTienda) productoDestacado = await getProductoDestacadoParaCliente(db, cliente);
  } catch {
    hayTienda = false;
    productoDestacado = null;
  }

  // 5) Reputación positiva — resiliente: nunca rompe la vista.
  let reputacion: {
    calificacion: typeof cliente.calificacion;
    creditosPagados: number;
  } | null = null;
  try {
    reputacion = {
      calificacion: cliente.calificacion,
      creditosPagados: await contarCreditosPagados(db, cliente.id),
    };
  } catch {
    reputacion = null;
  }

  // Rifa promocional: se muestra si el admin la activó y este cliente califica.
  // Si es un sorteo real (0098), se adjunta el número de ticket que ya tenga el cliente.
  const rifaBase = await getRifaParaCliente(db, clienteSeg);
  const miNumeroRifa = rifaBase ? await getParticipacionRifaCliente(db, rifaBase.id, cliente.id) : null;
  const rifa = rifaBase ? { ...rifaBase, miNumero: miNumeroRifa } : null;

  return (
    <VistaClienteScreen
      v={v}
      anuncios={anuncios}
      hayTienda={hayTienda}
      productoDestacado={productoDestacado}
      token={token}
      prestamoId={prestamo.id}
      rifa={rifa}
      creditoSelector={creditoSelector}
      reputacion={reputacion}
      promo={promo}
      compra={
        prestamo.origen === "tienda"
          ? {
              productoNombre: prestamo.producto_nombre ?? "Producto de la tienda",
              // "Empezó el …" — la fecha de inicio del crédito del artículo (antes solo se veía la fecha fin).
              inicio: prestamo.fecha_inicio
                ? new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo" }).format(
                    new Date(String(prestamo.fecha_inicio).slice(0, 10) + "T12:00:00"),
                  )
                : null,
            }
          : null
      }
    />
  );
}

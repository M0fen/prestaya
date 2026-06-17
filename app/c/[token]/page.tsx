// ─────────────────────────────────────────────────────────────────────────
//  Vista de cliente REAL — acceso por link con token, SIN login.
//
//  Patrón seguro (Paso 6): el servidor recibe el token, consulta Supabase con
//  la SERVICE_ROLE_KEY (solo servidor), valida que el token corresponda a un
//  cliente y devuelve ÚNICAMENTE los datos de ese cliente. El navegador nunca
//  habla directo con Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import {
  getPrestamoActivoPorCliente,
  contarCreditosPagados,
} from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { getAnunciosActivos } from "@/lib/data/anuncios";
import { construirVistaCliente } from "@/lib/vistaCliente";
import type { Anuncio } from "@/types/db";
import { NEGOCIO } from "@/lib/negocio";
import { VistaClienteScreen } from "@/components/VistaClienteScreen";
import { SinCreditoActivo } from "@/components/SinCreditoActivo";

// Siempre datos frescos y "hoy" real del servidor: nunca cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export default async function VistaPorToken({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = createSupabaseAdmin();

  // 1) Validar el token → cliente. Si no existe, 404 (no revelamos nada).
  const cliente = await getClientePorToken(db, token);
  if (!cliente) notFound();

  // 2) Préstamo activo del cliente. Puede no tener uno.
  const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
  if (!prestamo) {
    return <SinCreditoActivo nombre={cliente.nombre} negocio={NEGOCIO} />;
  }

  // 3) Pagos vigentes + cálculo + render. "hoy" = fecha real del servidor.
  const pagos = await getPagosDePrestamo(db, prestamo.id);
  const v = construirVistaCliente({
    cliente,
    prestamo,
    pagos,
    negocio: NEGOCIO,
    hoy: new Date(),
  });

  // 4) Banner de anuncios — RESILIENTE: si algo falla (o aún no existe la
  //    tabla), el crédito se muestra igual. El banner nunca rompe la vista.
  const segmento =
    v.estadoGeneral === "Estás al día" ? "al_dia" : "con_pendientes";
  let anuncios: Anuncio[] = [];
  try {
    anuncios = await getAnunciosActivos(db, segmento);
  } catch {
    anuncios = [];
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

  return (
    <VistaClienteScreen
      v={v}
      anuncios={anuncios}
      token={token}
      reputacion={reputacion}
    />
  );
}

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
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getRecompensasActivas } from "@/lib/data/recompensas";
import { getSaldoEstrellas } from "@/lib/data/estrellas";
import { claveCiclo } from "@/lib/estrellas";
import { getEstadoRaspaCliente, getQuinielaAbierta, getParticipacionCliente } from "@/lib/data/promos";
import { cicloUY } from "@/lib/fecha";
import { juegoArcadeDe } from "@/lib/juegoAjustes";
import { construirVistaCliente } from "@/lib/vistaCliente";
import { calcularJuegoCliente } from "@/lib/juegoCliente";
import { evaluarRecompensas } from "@/lib/recompensas";
import { hoyUY } from "@/lib/fecha";
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

  // Config del cliente definida por el admin (ciclo de estrellas, umbral caritas).
  const ajustes = await getAjustesJuego(db);

  // Estrellas: recompensa real (resiliente a que 0020 no exista). El ciclo del
  // tope lo define el admin: por mes o por crédito.
  const cicloEstrellas = claveCiclo(ajustes.estrellasCiclo, {
    cicloMes: cicloUY(),
    prestamoId: prestamo.id,
  });
  const estrellas = await getSaldoEstrellas(db, cliente.id, cicloEstrellas);

  // Juegos promocionales (resiliente a que 0021 no exista).
  const [raspa, quiniela] = await Promise.all([
    getEstadoRaspaCliente(db, cliente.id),
    getQuinielaAbierta(db),
  ]);
  const participacionNumero = quiniela
    ? await getParticipacionCliente(db, quiniela.id, cliente.id)
    : null;
  const promo = {
    raspaDisponibles: raspa.disponibles,
    quiniela: quiniela
      ? {
          id: quiniela.id,
          titulo: quiniela.titulo,
          premioTexto: quiniela.premioTexto,
          rangoMin: quiniela.rangoMin,
          rangoMax: quiniela.rangoMax,
        }
      : null,
    participacionNumero,
  };

  // Nombres de los cobradores que registraron pagos (para mostrar "quién cobró").
  const cobradorIds = [
    ...new Set(pagos.map((p) => p.registrado_por).filter((x): x is string => !!x)),
  ];
  const nombresCobrador: Record<string, string> = {};
  if (cobradorIds.length > 0) {
    const { data: us } = await db.from("usuarios").select("id, nombre").in("id", cobradorIds);
    for (const u of us ?? []) nombresCobrador[u.id as string] = u.nombre as string;
  }

  const v = construirVistaCliente({
    cliente,
    prestamo,
    pagos,
    negocio: NEGOCIO,
    hoy: hoyUY(),
    nombresCobrador,
  });

  // Zona de juego según la config del admin (ajustes ya leídos arriba).
  const juego = ajustes.activo
    ? calcularJuegoCliente(prestamo, pagos, hoyUY(), { metaRacha: ajustes.metaRacha })
    : null;
  const juegoArcade = ajustes.activo ? juegoArcadeDe(ajustes) : null;

  // Recompensas evaluadas contra el juego (resiliente a que 0018 no exista).
  const recompensas =
    juego != null ? evaluarRecompensas(await getRecompensasActivas(db), juego) : [];
  const temporada =
    ajustes.activo && ajustes.temporadaActiva && ajustes.temporadaNombre.trim()
      ? {
          nombre: ajustes.temporadaNombre,
          emoji: ajustes.temporadaEmoji,
          meta: ajustes.temporadaMeta,
          premio: ajustes.temporadaPremio,
        }
      : null;

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
      juego={juego}
      estrellas={estrellas}
      promo={promo}
      umbralCaritas={ajustes.umbralCaritas}
      juegoAjustes={{
        mensajeBienvenida: ajustes.mensajeBienvenida,
        premioMeta: ajustes.premioMeta,
        mostrarMisiones: ajustes.mostrarMisiones,
      }}
      juegoArcade={juegoArcade}
      recompensas={recompensas}
      temporada={temporada}
    />
  );
}

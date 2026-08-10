"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — CERRAR JORNADA (rendición del cobrador).
//  El cobrador declara gastos + efectivo entregado. El RECAUDADO lo pone el
//  servidor (suma de sus pagos de hoy): no se confía en el cliente para el
//  dinero. Calcula la diferencia con el núcleo puro y guarda (RLS: solo puede
//  crear la suya). Idempotente ante doble cierre (unique cobrador+fecha).
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { reportarError } from "@/lib/observabilidad";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { getUsuarioActual, esGestor, esAdmin } from "@/lib/auth";
import { getEstadoJornada, crearRendicionDb, getJornadasSinRendir } from "@/lib/data/rendicion";
import { alcanceDelActor } from "@/lib/data/alcance";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { registrarBitacora } from "@/lib/data/bitacora";
import { calcularRendicion, type EstadoRendicion } from "@/lib/rendicion";
import { esUuid } from "@/lib/idempotencia";
import { UYU, toIso } from "@/lib/format";
import { hoyUY, sumarDiasYmd } from "@/lib/fecha";

type Resultado =
  | { ok: true; estado: EstadoRendicion; diferencia: number; esperado: number }
  | { ok: false; error: string };

/** Un unique violation (ya rindió hoy) se trata como "ya cerrada". */
function esDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function cerrarJornada(input: {
  gastos: number;
  entregado: number;
  notas?: string | null;
}): Promise<Resultado> {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo) return { ok: false, error: "Sesión no válida." };
  const bloqueo = await bloqueoSoloLectura(); // kill switch
  if (bloqueo) return bloqueo;

  const db = await createSupabaseServer();
  // "Hoy" se captura UNA sola vez y viaja hasta el INSERT: antes la `fecha` de la
  // rendición la ponía el default de la BD AL MOMENTO del insert → un cierre
  // confirmado 23:59 que commiteaba 00:00 quedaba fechado MAÑANA con la plata de
  // HOY (hoy figuraba "sin rendir" y mañana quedaba bloqueado por el unique).
  const hoy = new Date();
  const estado = await getEstadoJornada(db, usuario.id, hoy);
  if (!estado.disponible) {
    return { ok: false, error: "El cierre de jornada todavía no está habilitado." };
  }
  if (estado.yaRendida) return { ok: false, error: "Ya cerraste tu jornada de hoy." };

  const gastosDeclarados = Math.max(0, Math.round(Number(input.gastos) || 0));
  const entregado = Math.max(0, Math.round(Number(input.entregado) || 0));
  let notas = (input.notas ?? "").toString().trim().slice(0, 300) || null;

  // ANTI-FUGA (server-side): los gastos que reducen el "esperado" NO pueden superar
  // lo RESPALDADO por solicitudes de hoy (aprobadas + pendientes, por fecha de
  // solicitud). Sin este tope, un cobrador declaraba gastos FANTASMA para llevar el
  // esperado a 0 y la rendición marcaba "cuadra ✓" (embolsándose el recaudo); y un
  // gasto aprobado tarde se contaba dos veces entre días. El EXCEDENTE sin respaldo
  // NO se descuenta → aflora como FALTANTE visible + queda nota automática para
  // trazarlo. Para un cobrador honesto (gastos respaldados) el tope es un no-op.
  const gastos = Math.min(gastosDeclarados, estado.gastosRespaldadosHoy);
  const excedente = gastosDeclarados - gastos;
  if (excedente > 0) {
    const aviso = `Declaró ${UYU(gastosDeclarados)} en gastos; solo ${UYU(gastos)} respaldados por solicitudes de hoy (excedente ${UYU(excedente)} sin comprobar).`;
    notas = notas ? `${aviso} · ${notas}`.slice(0, 300) : aviso.slice(0, 300);
  }

  // esperado = base + cobros − gastos − COLOCADO. El capital que puso en la calle
  // hoy (renovaciones/ventas) ya no lo tiene: pedírselo le inventa un faltante.
  const { esperado, diferencia, estado: est, aFavor } = calcularRendicion(
    estado.recaudado,
    gastos,
    entregado,
    estado.base,
    estado.colocado,
  );

  // ⚠️ EL COBRADOR PUSO PLATA DE SU BOLSILLO. Cuando el capital colocado se pasa de
  // lo que tenía encima, el "a entregar" se topa en $0 y el acta salía "Cuadra ✓"
  // sin decir en ningún lado que la oficina le quedó debiendo. La tabla no tiene
  // columna para esto (sería DDL), pero la NOTA es parte del acta inmutable: ahí
  // queda el número, con su fecha y su firma, que es lo que hace falta para que
  // pueda reclamarlo. Casos reales: Víctor Moralez $29.020 (08-07) y $18.260 (08-08).
  if (aFavor > 0) {
    // ⚠️ El insumo de este número es la BASE, y hoy la base se pierde cuando el
    // cobrador no cierra el día en que se la entregaron: al día siguiente vale $0
    // para toda la app. Medido: de los 6 días-cobrador con "a favor" del piloto
    // ($92.470), CUATRO ($76.080, el 99% de la plata) son de gente que tenía base
    // entregada y no devuelta — o sea, un reclamo FALSO contra la oficina, con
    // fecha y firma, en un acta que no se puede editar.
    // Mientras la base no arrastre bien, la nota deja el dato y la duda, no una
    // cifra absoluta: acusar de menos se corrige, acusar de más queda escrito.
    const aviso =
      `A FAVOR DEL COBRADOR ${UYU(aFavor)}: colocó ${UYU(estado.colocado)} y no le alcanzaba con lo del día` +
      (estado.base > 0 ? "." : " (base $0 registrada — VERIFICAR con el supervisor si tenía base sin rendir).");
    notas = notas ? `${aviso} · ${notas}`.slice(0, 300) : aviso.slice(0, 300);
  }

  try {
    await crearRendicionDb({
      cobradorId: usuario.id,
      fecha: toIso(hoyUY(hoy)),
      recaudado: estado.recaudado,
      cobrosCantidad: estado.cobrosCantidad,
      gastos,
      entregado,
      diferencia,
      base: estado.base,
      // Se CONGELA el colocado con el que se calculó la diferencia (0136): si no,
      // una renovación posterior al cierre movía el "a entregar" de un acta firmada.
      colocado: estado.colocado,
      creditosColocados: estado.creditosColocados,
      notas,
      registradoPor: usuario.id,
    });
    await registrarAuditoria(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      accion: "Cerró jornada",
      entidad: "rendicion",
      detalle: `Entregó ${UYU(entregado)} · ${est}${diferencia !== 0 ? ` ${UYU(Math.abs(diferencia))}` : ""}`,
    });
    await registrarBitacora(db, {
      actorId: usuario.id,
      actorNombre: usuario.nombre,
      rol: usuario.rol,
      accion: "cierre_jornada",
      monto: entregado,
      detalle: `${est} · entregó ${UYU(entregado)}`,
    });
    return { ok: true, estado: est, diferencia, esperado };
  } catch (e) {
    if (esDuplicado(e)) return { ok: false, error: "Ya cerraste tu jornada de hoy." };
    reportarError("cerrarJornada", e);
    return { ok: false, error: "No se pudo cerrar la jornada. Probá de nuevo." };
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  ENTREGA DIFERIDA — el supervisor registra el efectivo de una jornada VIEJA.
//
//  El agujero más caro del piloto: la app solo sabe cerrar el día de HOY. Si al
//  cobrador se le pasó la noche —cargó a las 23:00 desde la casa y se fue a
//  dormir— esa jornada queda incerrable PARA SIEMPRE, y el supervisor no tiene
//  dónde anotar que recibió la plata. Medido el 10-08: 40 jornadas abiertas de 19
//  cobradores, $2.702.391, la más vieja del 10 de julio.
//
//  La plata no está perdida: el libro de pagos la tiene toda. Lo que falta es el
//  PAPEL — sin acta, ni el cobrador puede probar que entregó ni la oficina que
//  recibió, y la alerta de "sin rendir" queda encendida para siempre hasta que se
//  la deja de mirar.
//
//  DOBLE FIRMA: el acta queda a nombre del COBRADOR (es su jornada) pero
//  `registrado_por` es el SUPERVISOR, y la nota dice quién la registró y cuándo.
//  Es la diferencia entre "el cobrador declaró" y "el supervisor recibió": las dos
//  cosas son ciertas y las dos tienen que estar escritas.
//
//  Lo que NO se toca: el recaudado, la base, los gastos y el capital colocado los
//  pone el SERVIDOR desde los datos de ESE día. El supervisor solo declara cuánto
//  efectivo recibió — que es lo único que él sabe y el sistema no.
// ─────────────────────────────────────────────────────────────────────────
export async function registrarEntregaDiferida(input: {
  cobradorId: string;
  /** Día UY "YYYY-MM-DD" de la jornada que se cierra. */
  fecha: string;
  /** Efectivo que el supervisor recibió en mano. */
  entregado: number;
  notas?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol))
    return { ok: false, error: "Esta acción es de la oficina." };
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  if (!esUuid(input.cobradorId)) return { ok: false, error: "Cobrador inválido." };

  const hoy = new Date();
  const fechaHoy = toIso(hoyUY(hoy));
  const fecha = String(input.fecha ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Fecha inválida." };
  // HOY tiene su propio cierre, que lo hace el cobrador desde su teléfono: dejarlo
  // acá permitiría cerrarle el día a alguien que todavía está en la calle cobrando.
  if (fecha >= fechaHoy)
    return {
      ok: false,
      error: "La jornada de hoy la cierra el cobrador desde su teléfono. Acá se registran las que quedaron abiertas de días anteriores.",
    };
  // Ventana de 30 días: más atrás no es operación, es arqueología — y un acta
  // fechada meses atrás mueve comisiones ya liquidadas.
  if (fecha < sumarDiasYmd(fechaHoy, -30))
    return { ok: false, error: "Esa jornada tiene más de 30 días. Resolvela con la oficina." };

  const entregado = Math.max(0, Math.round(Number(input.entregado) || 0));
  if (!Number.isFinite(entregado)) return { ok: false, error: "Revisá el monto entregado." };

  try {
    const db = await createSupabaseServer();
    // ⚠️ EL SUPERVISOR SOLO CIERRA A SU GENTE. La RLS de `rendiciones` no acota por
    // zona en la escritura, así que el alcance se exige acá: sin esto un supervisor
    // podría sellar la jornada de un cobrador de otra zona.
    if (!esAdmin(u.rol)) {
      const alcance = await alcanceDelActor();
      if (!alcance.global && !alcance.cobradorIds.includes(input.cobradorId))
        return { ok: false, error: "Ese cobrador no es de tu zona." };
    }

    // Los números de ESE día los pone el servidor, no la pantalla.
    const abiertas = await getJornadasSinRendir(db, [input.cobradorId], hoy, 30);
    const j = abiertas.find((x) => x.fecha === fecha);
    if (!j)
      return {
        ok: false,
        error: "Esa jornada ya está cerrada o no tiene cobros registrados. Recargá la pantalla.",
      };

    const { esperado, diferencia, estado: est, aFavor } = calcularRendicion(
      j.recaudado,
      j.gastos,
      entregado,
      j.base,
      j.colocado,
    );
    // La nota deja escrita la DOBLE FIRMA. Es lo que distingue un acta que el
    // cobrador confirmó en su teléfono de una que registró la oficina por él.
    const cabecera = `ENTREGA DIFERIDA: la registró ${u.nombre} el ${fechaHoy} por la jornada del ${fecha}.`;
    const extra = aFavor > 0 ? ` A favor del cobrador ${UYU(aFavor)} (colocó ${UYU(j.colocado)}).` : "";
    const notas = `${cabecera}${extra}${input.notas ? ` · ${String(input.notas).trim()}` : ""}`.slice(0, 300);

    await crearRendicionDb({
      cobradorId: input.cobradorId,
      fecha,
      recaudado: j.recaudado,
      cobrosCantidad: j.cobros,
      gastos: j.gastos,
      entregado,
      diferencia,
      base: j.base,
      colocado: j.colocado,
      creditosColocados: 0,
      notas,
      // ⚠️ La FIRMA de quien recibió. El acta es del cobrador (su jornada, su
      // plata) pero quien la registró es el supervisor, y eso tiene que poder
      // reconstruirse después sin preguntarle a nadie.
      registradoPor: u.id,
    });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Registró la entrega de una jornada vieja",
      entidad: "rendicion",
      entidadId: input.cobradorId,
      detalle: `${j.cobradorNombre} · jornada del ${fecha} (hace ${j.antiguedad} día${j.antiguedad === 1 ? "" : "s"}) · esperado ${UYU(esperado)} · recibió ${UYU(entregado)} · ${est}${diferencia !== 0 ? ` ${UYU(Math.abs(diferencia))}` : ""}`,
    });
    revalidatePath("/admin/jornada");
    revalidatePath("/admin/alertas");
    revalidatePath("/admin");
    return { ok: true, estado: est, diferencia, esperado };
  } catch (e) {
    if (esDuplicado(e))
      return { ok: false, error: "Esa jornada ya tiene su acta. Recargá la pantalla." };
    reportarError("registrarEntregaDiferida", e, { cobradorId: input.cobradorId, fecha });
    return { ok: false, error: "No se pudo registrar la entrega. Probá de nuevo." };
  }
}

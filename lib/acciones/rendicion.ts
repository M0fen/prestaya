"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — CERRAR JORNADA (rendición del cobrador).
//  El cobrador declara gastos + efectivo entregado. El RECAUDADO lo pone el
//  servidor (suma de sus pagos de hoy): no se confía en el cliente para el
//  dinero. Calcula la diferencia con el núcleo puro y guarda (RLS: solo puede
//  crear la suya). Idempotente ante doble cierre (unique cobrador+fecha).
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseServer } from "@/lib/supabase/server";
import { reportarError } from "@/lib/observabilidad";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { getUsuarioActual } from "@/lib/auth";
import { getEstadoJornada, crearRendicionDb } from "@/lib/data/rendicion";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { registrarBitacora } from "@/lib/data/bitacora";
import { calcularRendicion, type EstadoRendicion } from "@/lib/rendicion";
import { UYU, toIso } from "@/lib/format";
import { hoyUY } from "@/lib/fecha";

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
    const aviso = `A FAVOR DEL COBRADOR ${UYU(aFavor)}: colocó ${UYU(estado.colocado)} y puso esa diferencia de su bolsillo.`;
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

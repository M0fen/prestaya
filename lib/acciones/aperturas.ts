"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — BASE DE CAJA (0105): el gestor fija con qué efectivo arranca
//  un cobrador el día. La RLS (0105) lo acota a su zona (admin = todos). No es
//  un pago (es efectivo bajo custodia que el cobrador devuelve al cerrar), así
//  que se puede corregir durante el día (upsert por cobrador+fecha). Auditado.
// ─────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";
import { esUuid } from "@/lib/idempotencia";
import { setAperturaDb } from "@/lib/data/aperturas";
import { registrarAuditoria } from "@/lib/data/auditoria";
import { UYU } from "@/lib/format";
import { fechaISOUY } from "@/lib/fecha";

type Resultado = { ok: true } | { ok: false; error: string };

/** Fija (o corrige) la base de arranque de HOY de un cobrador. Solo gestor; la
 *  RLS acota al supervisor a su zona. Tope de $1.000.000 por prudencia. */
export async function setApertura(input: {
  cobradorId: string;
  base: number;
  nota?: string | null;
}): Promise<Resultado> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  // Kill switch: la base entra al `esperado` de la rendición (esperado = base +
  // recaudado − gastos). Bajar la base cambia a posteriori cuánto debe entregar un
  // cobrador → durante un freeze (investigando un descuadre) NO se puede tocar,
  // igual que el resto de las escrituras de custodia (cierre/rendición/comisión).
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  if (!esUuid(input.cobradorId)) return { ok: false, error: "Cobrador inválido." };
  const base = Math.max(0, Math.min(1_000_000, Math.round(Number(input.base) || 0)));
  const nota = (input.nota ?? "").trim().slice(0, 200) || null;
  try {
    const db = await createSupabaseServer();
    // ── La base se CONGELA cuando el cobrador rinde ────────────────────────
    // `esperado = base + recaudado − gastos`, y la rendición guarda su propia
    // copia de la base. Editarla después no cambia lo ya rendido: solo crea una
    // divergencia que INV6 marca a la mañana siguiente. Y en el sentido
    // peligroso —subirla sabiendo lo que el cobrador trae— serviría para
    // fabricarle un faltante. Cerrado acá, con mensaje que explica la salida.
    const hoy = fechaISOUY();
    const { data: yaRindio } = await db
      .from("rendiciones")
      .select("id")
      .eq("cobrador_id", input.cobradorId)
      .eq("fecha", hoy)
      .maybeSingle();
    if (yaRindio) {
      return {
        ok: false,
        error: "Ese cobrador ya cerró su jornada de hoy: la base quedó sellada con su rendición. Si el monto estaba mal, anotalo como diferencia en el cierre de zona.",
      };
    }
    await setAperturaDb(db, { cobradorId: input.cobradorId, base, entregadaPor: u.id, nota });
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Fijó la base de caja de un cobrador",
      entidad: "caja",
      entidadId: input.cobradorId,
      detalle: `Base ${UYU(base)}`,
    });
    revalidatePath("/admin/jornada");
    revalidatePath("/admin");
    revalidatePath("/cobrador");
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo fijar la base. Probá de nuevo." };
  }
}

/**
 * Fija las bases de VARIOS cobradores de una (decisión 08-05): cargar 14 bases
 * eran 14 taps con 14 recargas de la página pesada de la jornada. Misma lógica
 * y guardas que setApertura (gestor, kill-switch, base sellada tras rendir),
 * pero UNA sesión, UNA auditoría-resumen y UN revalidate.
 */
export async function setAperturasLote(input: {
  items: { cobradorId: string; base: number }[];
}): Promise<
  | { ok: true; guardadas: number; rechazadas: { cobradorId: string; error: string }[] }
  | { ok: false; error: string }
> {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esGestor(u.rol)) return { ok: false, error: "No tenés permisos." };
  const bloqueo = await bloqueoSoloLectura();
  if (bloqueo) return bloqueo;
  // ⚠️ El tope era 60 y cortaba EN SILENCIO: con 61 cobradores, el 61 se caía del
  // guardado sin que nadie lo dijera — botón verde, cobrador con efectivo en la
  // mano, cero registro. Hoy son 52 (8 de margen), así que todavía no muerde, pero
  // el corte mudo es exactamente la clase de cosa que se descubre con una auditoría
  // tres meses tarde. Se sube el tope y, si aun así sobra, se AVISA.
  const TOPE_LOTE = 200;
  const todos = (input.items ?? []).filter((x) => esUuid(x.cobradorId));
  const items = todos.slice(0, TOPE_LOTE);
  if (items.length === 0) return { ok: false, error: "No hay bases para guardar." };
  if (todos.length > TOPE_LOTE)
    return {
      ok: false,
      error: `Son ${todos.length} bases y el máximo por vez es ${TOPE_LOTE}. Guardá en dos tandas (usá el buscador para filtrar).`,
    };

  const db = await createSupabaseServer();
  const hoy = fechaISOUY();
  // Rendidos de HOY en una sola consulta (base sellada, misma regla que arriba).
  const { data: rendidos } = await db
    .from("rendiciones")
    .select("cobrador_id")
    .eq("fecha", hoy)
    .in("cobrador_id", items.map((x) => x.cobradorId));
  const sellados = new Set((rendidos ?? []).map((r) => r.cobrador_id as string));

  // ⚠️ VALOR ANTERIOR de cada uno, ANTES de pisarlo. La auditoría del lote decía
  // "Fijó las bases de caja del día · 1 cobrador · total $10.000" y nada más: no
  // decía a QUIÉN ni DE CUÁNTO A CUÁNTO. Un rastro que no dice de qué a qué no
  // sirve para auditar — y bajarle la base a alguien antes de que confirme el
  // cierre es justamente la forma de taparle un faltante. Es la acción que el
  // dueño hace todos los días y era la que peor traza dejaba.
  const { data: previas } = await db
    .from("aperturas_caja")
    .select("cobrador_id, base")
    .eq("fecha", hoy)
    .in("cobrador_id", items.map((x) => x.cobradorId));
  const antesDe = new Map(
    (previas ?? []).map((p) => [p.cobrador_id as string, Math.round(Number(p.base) || 0)]),
  );
  const { data: nombres } = await db
    .from("usuarios")
    .select("id, nombre")
    .in("id", items.map((x) => x.cobradorId));
  const nombreDe = new Map((nombres ?? []).map((n) => [n.id as string, n.nombre as string]));

  let guardadas = 0;
  let total = 0;
  const detalles: string[] = [];
  const rechazadas: { cobradorId: string; error: string }[] = [];
  for (const it of items) {
    if (sellados.has(it.cobradorId)) {
      rechazadas.push({ cobradorId: it.cobradorId, error: "Ya cerró su jornada: base sellada." });
      continue;
    }
    const base = Math.max(0, Math.min(1_000_000, Math.round(Number(it.base) || 0)));
    try {
      await setAperturaDb(db, { cobradorId: it.cobradorId, base, entregadaPor: u.id, nota: null });
      guardadas += 1;
      total += base;
      const antes = antesDe.get(it.cobradorId);
      const quien = nombreDe.get(it.cobradorId) ?? "cobrador";
      detalles.push(
        antes == null || antes === base
          ? `${quien} ${UYU(base)}`
          : `${quien} ${UYU(antes)}→${UYU(base)}`,
      );
    } catch {
      rechazadas.push({ cobradorId: it.cobradorId, error: "No se pudo guardar." });
    }
  }
  if (guardadas > 0) {
    await registrarAuditoria(db, {
      actorId: u.id,
      actorNombre: u.nombre,
      accion: "Fijó las bases de caja del día",
      entidad: "caja",
      entidadId: u.id,
      // Quién y de cuánto a cuánto, uno por uno. Se recorta a 400 para no reventar
      // la fila con 47 nombres: lo que se pierde es la cola, no las correcciones.
      detalle: `${guardadas} cobrador${guardadas === 1 ? "" : "es"} · total ${UYU(total)} · ${detalles.join(", ")}`.slice(0, 400),
    });
    revalidatePath("/admin/jornada");
    revalidatePath("/admin");
    revalidatePath("/cobrador");
  }
  return { ok: true, guardadas, rechazadas };
}

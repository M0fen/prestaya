"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Ojito del cobrador: peek COMPACTO de un cliente sin salir de la ruta.
//  Todo por RLS (createSupabaseServer) → el cobrador solo puede espiar a SUS
//  clientes asignados; si el id no es suyo, getClientePorId devuelve null.
//  Lectura pura (reusa las capas ya testeadas del detalle). Nada escribe.
// ─────────────────────────────────────────────────────────────────────────
import { requireUsuario } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { getNotasCliente } from "@/lib/data/notas";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY, inicioDiaUYIso } from "@/lib/fecha";

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PeekCliente {
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  calificacion: string | null;
  /** Datos del crédito activo principal (null si no tiene). */
  cuota: number;
  saldo: number;
  progresoPct: number;
  diasCubiertos: number;
  totalDias: number;
  pagadoHoy: number;
  /** Cuántos créditos SUYOS tiene el cliente: los números de arriba son la SUMA
   *  de todos. Con más de uno, el modal lo dice para que el número no sorprenda. */
  creditos: number;
  tieneCredito: boolean;
  ultimosPagos: { fecha: string; monto: number }[];
  notasCount: number;
  ultimaNota: string | null;
}

export type ResultadoPeek = { ok: true; ficha: PeekCliente } | { ok: false; error: string };

export async function peekClienteCobrador(clienteId: string): Promise<ResultadoPeek> {
  // ⚠️ El usuario NO se descartaba y hacía falta: la RLS de `prestamos` filtra por
  // CLIENTE, no por crédito, así que en un cliente compartido entre dos rutas (57
  // pares reales) el ojito le mostraba al cobrador el crédito del COMPAÑERO —
  // cuota, saldo y avance ajenos. Ese es exactamente el error del día 1.
  const usuario = await requireUsuario();
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };

  // Todo el cuerpo en try/catch: un error transitorio de DB no debe dejar el
  // ojito colgado en "Cargando…" (el cliente espera {ok:false} para mostrar error).
  try {
    const db = await createSupabaseServer();
    const cliente = await getClientePorId(db, clienteId);
    if (!cliente) return { ok: false, error: "No encontrado o fuera de tu ruta." };

    const activos = await getPrestamosActivosPorCliente(db, clienteId);
    // Solo los créditos SUYOS: el del compañero no es su cuota ni su plata. Un
    // crédito sin dueño se muestra igual (no hay a quién atribuírselo). Mismo
    // criterio que la ruta y que `resolverPrestamo` al imputar el cobro.
    const mios =
      usuario.rol === "cobrador"
        ? activos.filter((p) => !p.cobrador_id || p.cobrador_id === usuario.id)
        : activos;
    let cuota = 0;
    let saldo = 0;
    let progresoPct = 0;
    let diasCubiertos = 0;
    let totalDias = 0;
    let pagadoHoy = 0;
    let ultimosPagos: { fecha: string; monto: number }[] = [];

    // ⚠️ TODOS sus créditos, no solo el primero. El ojito existe para decidir
    // cuánto pedirle al cliente SIN abrir la ficha, y con `mios[0]` mostraba la
    // cuota de UN crédito —el más nuevo— en los clientes con varios del mismo
    // cobrador: 104 casos en Zona Centro donde decía un número más chico que la
    // tarjeta de al lado. Peor: "Hoy: sin pago" se calculaba sobre ese crédito
    // suelto, así que si ya había cobrado en otro lo invitaba a cobrar de nuevo.
    const desde = inicioDiaUYIso();
    let pagadoTotal = 0;
    let totalAPagar = 0;
    for (const p of mios) {
      const pagos = await getPagosDePrestamo(db, p.id);
      const r = calcularEstadosCarton(p, pagos, hoyUY());
      cuota += p.cuota_diaria;
      saldo += r.falta;
      diasCubiertos += r.dias.filter((d) => d.estado === "pagado").length;
      totalDias += p.total_dias;
      pagadoTotal += r.totalPagado;
      totalAPagar += r.totalAPagar;
      pagadoHoy += pagos
        .filter((x) => !x.anulado && x.registrado_en >= desde)
        .reduce((s, x) => s + Number(x.monto), 0);
      ultimosPagos.push(
        ...pagos
          .filter((x) => !x.anulado)
          .map((x) => ({ fecha: x.registrado_en, monto: Number(x.monto) })),
      );
    }
    // Avance sobre el conjunto, no sobre un crédito suelto.
    progresoPct = totalAPagar > 0 ? Math.round((pagadoTotal / totalAPagar) * 100) : 0;
    ultimosPagos = ultimosPagos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, 3);

    const notas = await getNotasCliente(db, clienteId);

    return {
      ok: true,
      ficha: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
        calificacion: cliente.calificacion ?? null,
        cuota,
        saldo,
        progresoPct,
        diasCubiertos,
        totalDias,
        pagadoHoy,
        creditos: mios.length,
        tieneCredito: mios.length > 0,
        ultimosPagos,
        notasCount: notas.length,
        ultimaNota: notas[0]?.cuerpo ?? null,
      },
    };
  } catch {
    return { ok: false, error: "No se pudo cargar la ficha. Probá de nuevo." };
  }
}

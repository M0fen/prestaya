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
  tieneCredito: boolean;
  ultimosPagos: { fecha: string; monto: number }[];
  notasCount: number;
  ultimaNota: string | null;
}

export type ResultadoPeek = { ok: true; ficha: PeekCliente } | { ok: false; error: string };

export async function peekClienteCobrador(clienteId: string): Promise<ResultadoPeek> {
  await requireUsuario(); // exige sesión interna; RLS hace el resto del control
  if (!ES_UUID.test(clienteId)) return { ok: false, error: "Cliente inválido." };

  // Todo el cuerpo en try/catch: un error transitorio de DB no debe dejar el
  // ojito colgado en "Cargando…" (el cliente espera {ok:false} para mostrar error).
  try {
    const db = await createSupabaseServer();
    const cliente = await getClientePorId(db, clienteId);
    if (!cliente) return { ok: false, error: "No encontrado o fuera de tu ruta." };

    const activos = await getPrestamosActivosPorCliente(db, clienteId);
    const prestamo = activos[0] ?? null;

    let cuota = 0;
    let saldo = 0;
    let progresoPct = 0;
    let diasCubiertos = 0;
    let totalDias = 0;
    let pagadoHoy = 0;
    let ultimosPagos: { fecha: string; monto: number }[] = [];

    if (prestamo) {
      const pagos = await getPagosDePrestamo(db, prestamo.id);
      const r = calcularEstadosCarton(prestamo, pagos, hoyUY());
      cuota = prestamo.cuota_diaria;
      saldo = r.falta;
      progresoPct = r.progresoPct;
      diasCubiertos = r.dias.filter((d) => d.estado === "pagado").length;
      totalDias = prestamo.total_dias;

      const desde = inicioDiaUYIso();
      pagadoHoy = pagos
        .filter((p) => !p.anulado && p.registrado_en >= desde)
        .reduce((s, p) => s + Number(p.monto), 0);

      ultimosPagos = [...pagos]
        .filter((p) => !p.anulado)
        .sort((a, b) => (a.registrado_en < b.registrado_en ? 1 : -1))
        .slice(0, 3)
        .map((p) => ({ fecha: p.registrado_en, monto: Number(p.monto) }));
    }

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
        tieneCredito: Boolean(prestamo),
        ultimosPagos,
        notasCount: notas.length,
        ultimaNota: notas[0]?.cuerpo ?? null,
      },
    };
  } catch {
    return { ok: false, error: "No se pudo cargar la ficha. Probá de nuevo." };
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Capa de datos — FICHA RÁPIDA del cliente (para el modal "ojito" que se abre
//  en listas como Mora o Clientes, sin entrar al perfil completo). Resumen
//  compacto: contacto, calificación, créditos activos con saldo/mora del cartón,
//  score y foto. Reusa el cartón (verdad única) para no duplicar lógica.
// ─────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoScore } from "@/types/scoring";
import { calcularEstadosCarton } from "@/lib/cartones";
import { calcularScore } from "@/lib/scoring";
import { hoyUY } from "@/lib/fecha";
import { getPrestamosActivosPorCliente } from "./prestamos";
import { getPagosDePrestamo } from "./pagos";
import { getHistorialCrediticio } from "./scoring";
import { urlFirmadaFoto } from "./fotos";

export interface CreditoFicha {
  cuota: number;
  totalDias: number;
  pagados: number;
  atrasados: number;
  saldo: number;
  deudaVencida: number;
  progresoPct: number;
  proxima: string | null;
}

export interface FichaRapida {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  calificacion: string;
  reportado: boolean;
  fotoUrl: string | null;
  cobrador: string | null;
  /** Scoring crediticio completo (puntaje, banda, factores, recomendación, métricas). */
  score: ResultadoScore | null;
  creditos: CreditoFicha[];
}

const N = (v: unknown) => Number(v);

export async function getFichaRapida(
  db: SupabaseClient,
  clienteId: string,
  hoy: Date = new Date(),
): Promise<FichaRapida | null> {
  const { data: c } = await db.from("clientes").select("*").eq("id", clienteId).maybeSingle();
  if (!c) return null;

  const hoyCal = hoyUY(hoy);
  const activos = await getPrestamosActivosPorCliente(db, clienteId);
  const creditos: CreditoFicha[] = [];
  for (const p of activos) {
    const pagos = await getPagosDePrestamo(db, p.id);
    const r = calcularEstadosCarton(p, pagos, hoyCal);
    creditos.push({
      cuota: N(p.cuota_diaria),
      totalDias: N(p.total_dias),
      pagados: r.dias.filter((d) => d.estado === "pagado").length,
      atrasados: r.dias.filter((d) => d.estado === "atrasado").length,
      saldo: r.falta,
      deudaVencida: r.montoParaAlDia,
      progresoPct: r.progresoPct,
      proxima: r.proxima ? `día ${r.proxima.dia} · ${r.proxima.fecha}` : null,
    });
  }

  // Cobrador del primer crédito activo (nombre).
  let cobrador: string | null = null;
  const cobId = activos[0] ? (activos[0] as { cobrador_id?: string | null }).cobrador_id : null;
  if (cobId) {
    const { data: u } = await db.from("usuarios").select("nombre").eq("id", cobId).maybeSingle();
    cobrador = (u?.nombre as string | undefined) ?? null;
  }

  // Scoring interno completo (resiliente): puntaje + factores + recomendación + métricas.
  let score: ResultadoScore | null = null;
  try {
    const hist = await getHistorialCrediticio(db, clienteId);
    score = calcularScore({ ...hist, hoy: hoyCal });
  } catch {
    /* sin score */
  }

  const fotoUrl = await urlFirmadaFoto((c.foto_path as string | null) ?? null);

  return {
    id: c.id as string,
    nombre: (c.nombre as string) ?? "Cliente",
    documento: (c.documento as string | null) ?? null,
    telefono: (c.telefono as string | null) ?? null,
    direccion: (c.direccion as string | null) ?? null,
    calificacion: (c.calificacion as string | null) ?? "nuevo",
    reportado: Boolean(c.reportado),
    fotoUrl,
    cobrador,
    score,
    creditos,
  };
}

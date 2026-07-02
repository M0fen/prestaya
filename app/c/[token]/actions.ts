"use server";
// ─────────────────────────────────────────────────────────────────────────
//  Server Action — reportar "falta un pago".
//  Único write de la vista de cliente. Corre SOLO en el servidor: valida el
//  token (sin login), usa service_role y guarda el reporte. El navegador
//  nunca toca Supabase.
// ─────────────────────────────────────────────────────────────────────────
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientePorToken } from "@/lib/data/clientes";
import { getPrestamoActivoPorCliente } from "@/lib/data/prestamos";
import { crearReporte, contarReportesRecientes } from "@/lib/data/reportes";
import { upsertMascota } from "@/lib/data/mascota";
import { tablaFaltante } from "@/lib/data/errores";

export type ResultadoReporte = { ok: true } | { ok: false; error: string };

export async function reportarFaltaPago(input: {
  token: string;
  diaCredito?: number | null;
  montoReclamado?: number | null;
  comentario?: string | null;
}): Promise<ResultadoReporte> {
  try {
    const db = createSupabaseAdmin();

    // 1) Validar token → cliente (no revelamos nada si no existe).
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false, error: "Enlace no válido." };

    // 2) Rate-limit simple: máx. 3 reportes en 10 minutos por cliente.
    const desde = new Date(Date.now() - 10 * 60 * 1000);
    const recientes = await contarReportesRecientes(db, cliente.id, desde);
    if (recientes >= 3) {
      return {
        ok: false,
        error: "Ya recibimos tu aviso. Lo estamos revisando, gracias.",
      };
    }

    // 3) Saneamiento de entradas.
    const prestamo = await getPrestamoActivoPorCliente(db, cliente.id);
    const dia =
      typeof input.diaCredito === "number" &&
      input.diaCredito >= 1 &&
      input.diaCredito <= 366
        ? Math.floor(input.diaCredito)
        : null;
    const monto =
      typeof input.montoReclamado === "number" && input.montoReclamado > 0
        ? input.montoReclamado
        : null;
    const comentario = (input.comentario ?? "").toString().trim().slice(0, 500);

    await crearReporte(db, {
      cliente_id: cliente.id,
      prestamo_id: prestamo?.id ?? null,
      tipo: "falta_pago",
      dia_credito: dia,
      monto_reclamado: monto,
      comentario: comentario || null,
    });

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "No pudimos enviar tu aviso ahora. Probá de nuevo en un rato.",
    };
  }
}

// ── Guardar el estado de la MASCOTA (tamagotchi) ───────────────────────────
// Único write extra de la vista de cliente. Valida el token en el servidor y
// persiste con service_role. Best-effort: si la tabla 0012 aún no existe (o
// hay error), devuelve ok:false y el cliente sigue con su localStorage.
export async function guardarMascota(input: {
  token: string;
  especie: string;
  nombre: string;
  accesorio: string;
  carino: number;
  ultimaInteraccion: string | null;
}): Promise<{ ok: boolean }> {
  try {
    const db = createSupabaseAdmin();
    const cliente = await getClientePorToken(db, input.token);
    if (!cliente) return { ok: false };

    await upsertMascota(db, cliente.id, {
      especie: input.especie,
      nombre: input.nombre,
      accesorio: input.accesorio,
      carino: input.carino,
      ultimaInteraccion: input.ultimaInteraccion,
    });
    return { ok: true };
  } catch (e) {
    if (tablaFaltante(e)) return { ok: false };
    return { ok: false };
  }
}

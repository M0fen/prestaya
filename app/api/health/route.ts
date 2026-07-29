// Health-check público y liviano para un monitor de uptime externo (UptimeRobot /
// BetterStack). Hace un ping mínimo a la BD (head count, sin traer datos) y reporta
// el modo solo-lectura (kill-switch). 200 = sano · 503 = la BD no responde. No expone
// datos: solo el estado. Detección PROACTIVA de caídas antes de que avise un cobrador.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { bloqueoSoloLectura } from "@/lib/data/featureFlags";

export const dynamic = "force-dynamic";

export async function GET() {
  const inicio = Date.now();
  try {
    const db = createSupabaseAdmin();
    // Ping barato: cuenta cabecera (no trae filas).
    const { error } = await db.from("usuarios").select("id", { count: "exact", head: true });
    if (error) throw error;
    const soloLectura = Boolean(await bloqueoSoloLectura()); // kill-switch activo
    return NextResponse.json(
      { ok: true, db: "up", soloLectura, ms: Date.now() - inicio },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: "down", ms: Date.now() - inicio },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

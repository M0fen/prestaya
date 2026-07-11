// Registra un evento de navegación del usuario logueado (telemetría de uso 0064).
// Fire-and-forget desde <RegistroUso/>. El insert va por la sesión propia (RLS:
// usuario_id = app_usuario_id()). Nunca lanza al cliente.
import { NextResponse } from "next/server";
import { getUsuarioActual } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { registrarUsoDb } from "@/lib/data/uso";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = body && typeof body.path === "string" ? body.path : null;
    if (!path || !path.startsWith("/")) return NextResponse.json({ ok: false });
    const u = await getUsuarioActual();
    if (!u || !u.activo) return NextResponse.json({ ok: false });
    const db = await createSupabaseServer();
    await registrarUsoDb(db, { usuarioId: u.id, nombre: u.nombre, rol: u.rol, path });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

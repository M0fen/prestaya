// ─────────────────────────────────────────────────────────────────────────
//  Búsqueda de clientes para el Command Palette (Ctrl/Cmd+K) del panel.
//  Solo gestores. Corre como el usuario logueado (RLS lo limita). Devuelve lo
//  mínimo para pintar y saltar a la ficha; nada sensible.
// ─────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual, esGestor } from "@/lib/auth";
import { buscarClientesAdmin } from "@/lib/data/clientes";
import { busquedaQuery } from "@/lib/validacion/esquemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const usuario = await getUsuarioActual();
  if (!usuario || !usuario.activo || !esGestor(usuario.rol)) {
    return NextResponse.json({ ok: false, clientes: [] }, { status: 403 });
  }

  // Validación del término: 2..80 chars. Malformado → sin resultados (no 500).
  const parsed = busquedaQuery.safeParse(new URL(req.url).searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ ok: true, clientes: [] });
  const q = parsed.data;

  try {
    const db = await createSupabaseServer();
    const clientes = await buscarClientesAdmin(db, q, 8);
    return NextResponse.json({
      ok: true,
      clientes: clientes.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        documento: c.documento,
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, clientes: [] }, { status: 500 });
  }
}

// Foto EN VIVO para el tablero dev (/admin/en-vivo). La pide el navegador cada
// ~20 s. Solo desarrolladores (es_dev): cualquier otro recibe 403 sin datos.
import { NextResponse } from "next/server";
import { getUsuarioActual, esDev } from "@/lib/auth";
import { getEnVivo } from "@/lib/data/enVivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUsuarioActual();
  if (!u || !u.activo || !esDev(u)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const datos = await getEnVivo();
    return NextResponse.json(datos, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

// Layout de la app del cobrador. Mobile-first (la usa en la calle, en el
// teléfono). Exige usuario interno activo; barra superior con nombre + salir.
import Link from "next/link";
import { requireUsuario } from "@/lib/auth";
import { cerrarSesion } from "@/lib/auth-actions";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getTotalNoLeidos } from "@/lib/data/chat";
import { SyncEngine } from "@/components/cobrador/SyncEngine";

export const dynamic = "force-dynamic";

export default async function CobradorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await requireUsuario();
  const db = await createSupabaseServer();
  const noLeidos = await getTotalNoLeidos(db, usuario);

  return (
    <div className="flex min-h-screen justify-center bg-[#F4F6FB]">
      <div className="flex w-full max-w-[480px] flex-col">
        <header className="header-safe sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#E6EAF4] bg-[#0F1B3D] px-4 py-3">
          {/* El logo + nombre llevan SIEMPRE a la ruta (escape universal). */}
          <Link href="/cobrador" className="flex min-w-0 items-center gap-2.5" aria-label="Ir a mi ruta">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[14px] font-black text-white">
              P
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px] font-bold text-white">
                {usuario.nombre}
              </span>
              <span className="text-[10px] font-semibold tracking-wide text-white/45 uppercase">
                Cobrador
              </span>
            </div>
          </Link>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Link
              href="/cobrador/chat"
              aria-label="Chat"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[15px] hover:bg-white/10"
            >
              💬
              {noLeidos > 0 && (
                <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E06A6A] px-1 text-[10px] font-black text-white">
                  {noLeidos > 9 ? "9+" : noLeidos}
                </span>
              )}
            </Link>
            <Link
              href="/cobrador/notas"
              aria-label="Notas"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[15px] hover:bg-white/10"
            >
              📝
            </Link>
            <Link
              href="/cobrador/tutorial"
              aria-label="Cómo se usa"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[15px] hover:bg-white/10"
            >
              🎓
            </Link>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-bold text-white/80 hover:bg-white/10"
              >
                Salir
              </button>
            </form>
          </div>
        </header>

        <SyncEngine />

        <main className="flex-1 px-4 pt-4 pb-24">{children}</main>
      </div>
    </div>
  );
}

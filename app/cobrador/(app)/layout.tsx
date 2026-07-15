// Layout de la app del cobrador. Mobile-first (la usa en la calle, en el
// teléfono). Exige usuario interno activo; barra superior con nombre + salir.
import Link from "next/link";
import { requireUsuario } from "@/lib/auth";
import { cerrarSesion } from "@/lib/auth-actions";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getTotalNoLeidos } from "@/lib/data/chat";
import { SyncEngine } from "@/components/cobrador/SyncEngine";
import { CobradorBottomNav } from "@/components/cobrador/CobradorBottomNav";
import { RegistroUso } from "@/components/RegistroUso";

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
          {/* La navegación secundaria (chat/números/notas/ayuda) vive ahora en la
              barra INFERIOR, al alcance del pulgar. El header solo lleva "Salir". */}
          <form action={cerrarSesion} className="flex-shrink-0">
            <button
              type="submit"
              className="rounded-full border border-white/20 px-3.5 py-2 text-[12px] font-bold text-white/80 hover:bg-white/10"
            >
              Salir
            </button>
          </form>
        </header>

        <SyncEngine usuarioId={usuario.id} />
        <RegistroUso />

        <main className="flex-1 px-4 pt-4 pb-24">{children}</main>
        <CobradorBottomNav noLeidos={noLeidos} />
      </div>
    </div>
  );
}

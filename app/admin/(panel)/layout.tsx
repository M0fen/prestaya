// Layout protegido del panel. Exige usuario interno activo (si no, al login),
// arma la navegación según el rol y la barra superior con el usuario + salir.
import { redirect } from "next/navigation";
import { requireUsuario, etiquetaRol, esGestor } from "@/lib/auth";
import { SidebarNav } from "@/components/admin/SidebarNav";
import { cerrarSesion } from "@/lib/auth-actions";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getTotalNoLeidos } from "@/lib/data/chat";
import { AsesorFlotante } from "@/components/asesor/AsesorFlotante";
import { CommandPalette } from "@/components/admin/CommandPalette";
import { Toaster } from "@/components/ui/Toaster";
import { NotificacionesRealtime } from "@/components/admin/NotificacionesRealtime";

// El panel siempre con datos frescos (nada de prerender estático).
export const dynamic = "force-dynamic";

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await requireUsuario();
  // El panel entero es para gestores. Un cobrador logueado que intente entrar
  // por URL directa vuelve a su app (defensa en profundidad con el RLS).
  if (!esGestor(usuario.rol)) redirect("/cobrador");
  const db = await createSupabaseServer();
  const noLeidos = await getTotalNoLeidos(db, usuario);
  const iniciales = usuario.nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-[#F4F6FB] md:flex-row">
      {/* Barra lateral (desktop) / superior (mobile) */}
      <aside className="print:hidden flex flex-col bg-[#0F1B3D] md:min-h-screen md:w-60 md:flex-shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[16px] font-black text-white">
            P
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[14px] font-extrabold text-white">
              Presta Ya
            </span>
            <span className="text-[10.5px] font-semibold tracking-wide text-white/45 uppercase">
              Panel de control
            </span>
          </div>
        </div>
        <SidebarNav rol={usuario.rol} noLeidos={noLeidos} />
      </aside>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="print:hidden flex items-center justify-between gap-3 border-b border-[#E6EAF4] bg-white px-5 py-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-wide text-gris uppercase">
              {etiquetaRol[usuario.rol]}
            </span>
            <span className="text-[14px] font-bold text-tinta">
              {usuario.nombre}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CommandPalette rol={usuario.rol} />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF] text-[13px] font-extrabold text-azul">
              {iniciales}
            </div>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="rounded-full border border-[#DCE3F4] px-3.5 py-1.5 text-[12.5px] font-bold text-gris hover:bg-[#F4F6FB]"
              >
                Salir
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 p-5 md:p-7 print:p-0">{children}</main>
      </div>

      {/* Flotantes (asesor + avisos): fuera del documento impreso. */}
      <div className="print:hidden">
        {/* Asesor financiero IA (flotante), solo para gestores. */}
        {esGestor(usuario.rol) && <AsesorFlotante />}

        {/* Avisos flotantes + notificaciones en vivo del chat. */}
        <Toaster />
        <NotificacionesRealtime yoId={usuario.id} />
      </div>
    </div>
  );
}

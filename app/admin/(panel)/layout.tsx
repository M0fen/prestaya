// Layout protegido del panel. Exige usuario interno activo (si no, al login),
// arma la navegación según el rol y la barra superior con el usuario + salir.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUsuario, etiquetaRol, esGestor, esAdmin } from "@/lib/auth";
import { cookies } from "next/headers";
import { SidebarNav } from "@/components/admin/SidebarNav";
import { PanelBottomNav } from "@/components/admin/PanelBottomNav";
import { ModoOscuro } from "@/components/admin/ModoOscuro";
import { cerrarSesion } from "@/lib/auth-actions";
import { createSupabaseServer } from "@/lib/supabase/server";
import { estadoMfa } from "@/lib/seguridad/mfa";
import { getTotalNoLeidos } from "@/lib/data/chat";
import { AsesorFlotante } from "@/components/asesor/AsesorFlotante";
import { CommandPalette } from "@/components/admin/CommandPalette";
import { Toaster } from "@/components/ui/Toaster";
import { NotificacionesRealtime } from "@/components/admin/NotificacionesRealtime";
import { RegistroUso } from "@/components/RegistroUso";

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

  // 2FA "sticky": si el usuario YA activó 2FA pero la sesión sigue en aal1,
  // exigimos el código antes de entrar. (Fail-open: si el subsistema MFA falla,
  // estadoMfa devuelve false y no bloquea a nadie.)
  const mfa = await estadoMfa(db);
  if (mfa.stepUpPendiente) redirect("/mfa");
  // Aviso (no bloqueante) para el admin que todavía no activó 2FA.
  const falta2fa = esAdmin(usuario.rol) && !mfa.tieneFactor;

  const noLeidos = await getTotalNoLeidos(db, usuario);
  const tema = (await cookies()).get("tema")?.value === "oscuro" ? "oscuro" : "claro";
  const iniciales = usuario.nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div id="panel-root" data-tema={tema} className="flex min-h-screen flex-col bg-fondo md:flex-row">
      {/* Barra lateral — SOLO escritorio. En mobile navega el PanelBottomNav (abajo). */}
      <aside className="print:hidden hidden flex-col bg-[#0F1B3D] md:flex md:min-h-screen md:w-60 md:flex-shrink-0">
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
        <SidebarNav rol={usuario.rol} noLeidos={noLeidos} esDev={usuario.es_dev} />
      </aside>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="header-safe print:hidden sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-borde bg-tarjeta px-5 py-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-wide text-gris uppercase">
              {etiquetaRol[usuario.rol]}
            </span>
            <span className="text-[14px] font-bold text-tinta">
              {usuario.nombre}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ModoOscuro inicial={tema === "oscuro"} />
            <CommandPalette rol={usuario.rol} esDev={usuario.es_dev} />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF] text-[13px] font-extrabold text-azul">
              {iniciales}
            </div>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="rounded-full border border-borde px-3.5 py-1.5 text-[12.5px] font-bold text-gris hover:bg-suave"
              >
                Salir
              </button>
            </form>
          </div>
        </header>

        {falta2fa && (
          <Link
            href="/admin/seguridad"
            className="print:hidden flex items-center gap-2 border-b border-[#F0E2A8] bg-[#FFF8E6] px-5 py-2.5 text-[12.5px] font-bold text-[#8A6D1E] hover:bg-[#FFF3D6]"
          >
            🔐 Activá la verificación en dos pasos para blindar tu cuenta de administrador →
          </Link>
        )}
        {/* pb extra en mobile: deja lugar a la barra inferior fija. */}
        <main className="flex-1 p-5 pb-24 md:p-7 print:p-0">{children}</main>
      </div>

      {/* Navegación inferior (mobile): el flujo del día + Menú con todo. */}
      <PanelBottomNav rol={usuario.rol} noLeidos={noLeidos} esDev={usuario.es_dev} />

      {/* Telemetría de uso (0064): registra qué sección abre este usuario. */}
      <RegistroUso />

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

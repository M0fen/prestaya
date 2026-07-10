// Vista del chat interno (server component). Layout de DOS PANELES: a la
// izquierda el selector de canales vertical (agrupado + buscable), a la derecha
// la conversación (encabezado, mensajes y caja). Reusada por el panel admin y la
// app del cobrador (cambia `basePath`). El botón "Vaciar" solo aparece al admin.
import type { Canal, MensajeVista } from "@/lib/data/chat";
import type { AmbitoMensaje } from "@/types/db";
import { Composer } from "./Composer";
import { MarcarLeido } from "./MarcarLeido";
import { RealtimeChat } from "./RealtimeChat";
import { ListaMensajes } from "./ListaMensajes";
import { VaciarChat } from "./VaciarChat";
import { SelectorCanales } from "./SelectorCanales";

const ICONO_CANAL: Record<AmbitoMensaje, string> = {
  general: "👥",
  supervisores: "🎖️",
  zona: "🗺️",
  cobrador: "💬",
};
const SUBTITULO_CANAL: Record<AmbitoMensaje, string> = {
  general: "Canal del equipo",
  supervisores: "Solo admin y supervisores",
  zona: "Admin, supervisor y cobradores de la zona",
  cobrador: "Hilo privado con la oficina",
};

export function ChatVista({
  basePath,
  canales,
  canalActivo,
  mensajes,
  esAdmin = false,
}: {
  basePath: string;
  canales: Canal[];
  canalActivo: string;
  mensajes: MensajeVista[];
  /** Muestra el botón "Vaciar" del canal (solo admin). */
  esAdmin?: boolean;
}) {
  const activo = canales.find((c) => c.key === canalActivo) ?? canales[0];
  const hayNoLeidos = (activo?.noLeidos ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(220px,260px)_1fr] md:items-start md:gap-4">
      {/* Panel izquierdo: selector vertical, agrupado y buscable. */}
      <SelectorCanales canales={canales} canalActivo={activo?.key ?? "general"} basePath={basePath} />

      {/* Panel derecho: conversación del canal activo. */}
      <div className="flex min-w-0 flex-col gap-3">
        {activo && (
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF3FF] text-[15px]">
                {ICONO_CANAL[activo.ambito]}
              </span>
              <div className="flex flex-col leading-tight">
                <span className="text-[13.5px] font-extrabold text-tinta">{activo.titulo}</span>
                <span className="text-[11px] font-medium text-[#8A93AD]">
                  {SUBTITULO_CANAL[activo.ambito]}
                </span>
              </div>
            </div>
            {esAdmin && mensajes.length > 0 && <VaciarChat canal={activo.key} titulo={activo.titulo} />}
          </div>
        )}

        {/* Mensajes (scroll propio, auto-baja) */}
        <ListaMensajes mensajes={mensajes} />

        <Composer canal={activo?.key ?? "general"} />
        {activo && <MarcarLeido canal={activo.key} hayNoLeidos={hayNoLeidos} />}
        {activo && (
          <RealtimeChat ambito={activo.ambito} cobradorId={activo.cobradorId} zonaId={activo.zonaId} />
        )}
      </div>
    </div>
  );
}

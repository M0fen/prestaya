// Vista del chat interno (server component). Selector de canales (Links con
// ?c=), lista de mensajes con scroll propio y caja para escribir. Reusada por
// el panel admin y la app del cobrador (cambia `basePath`). El botón "Vaciar"
// solo aparece para el admin.
import Link from "next/link";
import type { Canal, MensajeVista } from "@/lib/data/chat";
import { Composer } from "./Composer";
import { MarcarLeido } from "./MarcarLeido";
import { RealtimeChat } from "./RealtimeChat";
import { ListaMensajes } from "./ListaMensajes";
import { VaciarChat } from "./VaciarChat";

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
    <div className="flex flex-col gap-3">
      {/* Selector de canales (si hay más de uno) */}
      {canales.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {canales.map((c) => {
            const sel = c.key === activo?.key;
            return (
              <Link
                key={c.key}
                href={`${basePath}?c=${encodeURIComponent(c.key)}`}
                scroll={false}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                  sel ? "bg-[#2453DC] text-white" : "bg-white text-[#6B7494] hover:bg-[#EEF3FF]"
                }`}
              >
                {c.titulo}
                {!sel && c.noLeidos > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E06A6A] px-1 text-[10px] font-black text-white">
                    {c.noLeidos > 9 ? "9+" : c.noLeidos}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Encabezado del canal activo */}
      {activo && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF3FF] text-[15px]">
              {activo.ambito === "general" ? "👥" : "💬"}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[13.5px] font-extrabold text-tinta">{activo.titulo}</span>
              <span className="text-[11px] font-medium text-[#8A93AD]">
                {activo.ambito === "general" ? "Canal del equipo" : "Hilo privado con la oficina"}
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
      {activo && <RealtimeChat ambito={activo.ambito} cobradorId={activo.cobradorId} />}
    </div>
  );
}

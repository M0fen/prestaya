// Vista del chat interno (server component). Dos modos:
//  · ADMIN (ancho): DOS PANELES — selector vertical agrupado+buscable a la
//    izquierda, conversación a la derecha.
//  · COBRADOR (`compacto`, contenedor 480px, 2-3 canales): una sola columna con
//    chips horizontales arriba + conversación a ancho completo (el layout de dos
//    paneles se aplastaba en 480px y espachurraba el composer).
// El botón "Vaciar" solo aparece al admin.
import Link from "next/link";
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

/** Chips horizontales de canales (modo compacto del cobrador: pocos canales). */
function ChipsCanales({
  canales,
  activoKey,
  basePath,
}: {
  canales: Canal[];
  activoKey: string;
  basePath: string;
}) {
  if (canales.length <= 1) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {canales.map((c) => {
        const sel = c.key === activoKey;
        return (
          <Link
            key={c.key}
            href={`${basePath}?c=${encodeURIComponent(c.key)}`}
            scroll={false}
            className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
              sel ? "bg-[#2453DC] text-white" : "bg-white text-[#6B7494] hover:bg-[#EEF3FF]"
            }`}
          >
            <span>{ICONO_CANAL[c.ambito]}</span>
            <span className="whitespace-nowrap">{c.titulo}</span>
            {!sel && c.noLeidos > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E06A6A] px-1 text-[10px] font-black text-white">
                {c.noLeidos > 9 ? "9+" : c.noLeidos}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function ChatVista({
  basePath,
  canales,
  canalActivo,
  mensajes,
  esAdmin = false,
  compacto = false,
}: {
  basePath: string;
  canales: Canal[];
  canalActivo: string;
  mensajes: MensajeVista[];
  /** Muestra el botón "Vaciar" del canal (solo admin). */
  esAdmin?: boolean;
  /** Modo una-columna para contenedores angostos (app del cobrador). */
  compacto?: boolean;
}) {
  const activo = canales.find((c) => c.key === canalActivo) ?? canales[0];
  const hayNoLeidos = (activo?.noLeidos ?? 0) > 0;
  // Acuse de 1 toque: solo el cobrador (modo compacto), en los canales donde
  // recibe órdenes (su hilo privado con la oficina y el de su zona).
  const permitirAcuse = compacto && (activo?.ambito === "cobrador" || activo?.ambito === "zona");

  // Modo compacto (cobrador): una sola columna, chips arriba, todo a ancho completo.
  if (compacto) {
    return (
      <div className="flex flex-col gap-3">
        <ChipsCanales canales={canales} activoKey={activo?.key ?? "general"} basePath={basePath} />
        <Conversacion
          activo={activo}
          mensajes={mensajes}
          esAdmin={esAdmin}
          hayNoLeidos={hayNoLeidos}
          acuse={permitirAcuse}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(220px,260px)_1fr] md:items-start md:gap-4">
      {/* Panel izquierdo: selector vertical, agrupado y buscable. */}
      <SelectorCanales canales={canales} canalActivo={activo?.key ?? "general"} basePath={basePath} />

      {/* Panel derecho: conversación del canal activo. */}
      <Conversacion activo={activo} mensajes={mensajes} esAdmin={esAdmin} hayNoLeidos={hayNoLeidos} acuse={false} />
    </div>
  );
}

/** La conversación del canal activo (encabezado + mensajes + caja). Compartida. */
function Conversacion({
  activo,
  mensajes,
  esAdmin,
  hayNoLeidos,
  acuse,
}: {
  activo: Canal | undefined;
  mensajes: MensajeVista[];
  esAdmin: boolean;
  hayNoLeidos: boolean;
  /** Muestra los botones de acuse rápido en el compositor (cobrador). */
  acuse: boolean;
}) {
  return (
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

        <Composer canal={activo?.key ?? "general"} acuse={acuse} />
        {activo && <MarcarLeido canal={activo.key} hayNoLeidos={hayNoLeidos} />}
        {activo && (
          <RealtimeChat ambito={activo.ambito} cobradorId={activo.cobradorId} zonaId={activo.zonaId} />
        )}
    </div>
  );
}

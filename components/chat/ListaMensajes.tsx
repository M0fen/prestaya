"use client";
// Lista de mensajes del chat: contenedor con SCROLL propio (alto acotado) que
// auto-baja al último mensaje al entrar y al llegar uno nuevo, separadores por
// día, iniciales de color por autor y burbujas legibles. Muestra los mensajes
// RECIENTES y colapsa los viejos detrás de "Ver historial" (no abruma; se piden
// a demanda). Antes la lista crecía sin límite y no bajaba sola (se sentía "raro").
import { useEffect, useRef, useState } from "react";
import { horaDe } from "@/lib/format";
import type { MensajeVista } from "@/lib/data/chat";

// Cuántos mensajes recientes se muestran antes de ofrecer "Ver historial".
const RECIENTES = 20;

const COLORES = ["#2453DC", "#1FA971", "#B9770E", "#7A4DD6", "#C0392B", "#0E7C86"];
function colorDe(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) & 0xffff;
  return COLORES[h % COLORES.length];
}
function iniciales(nombre: string): string {
  return nombre.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "—";
}

/** Etiqueta de día ("Hoy" / "Ayer" / "12 de junio") a partir de un ISO. */
function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mismoDia(d, hoy)) return "Hoy";
  if (mismoDia(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-UY", { day: "numeric", month: "long" });
}

export function ListaMensajes({ mensajes }: { mensajes: MensajeVista[] }) {
  const finRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [verHistorial, setVerHistorial] = useState(false);

  // Por defecto solo los últimos RECIENTES; el resto queda en el historial.
  const ocultos = Math.max(0, mensajes.length - RECIENTES);
  const visibles = verHistorial || ocultos === 0 ? mensajes : mensajes.slice(-RECIENTES);

  // Baja al último mensaje al montar y cuando cambia la cantidad visible.
  useEffect(() => {
    const cont = scrollRef.current;
    if (cont) cont.scrollTop = cont.scrollHeight;
  }, [mensajes.length]);

  if (mensajes.length === 0) {
    return (
      <div className="flex h-[52vh] items-center justify-center rounded-[16px] border border-[#E6EAF4] bg-[#F4F6FB]">
        <p className="px-6 text-center text-[13px] font-medium text-[#8A93AD]">
          No hay mensajes todavía.<br />Escribí el primero. 👋
        </p>
      </div>
    );
  }

  let ultimoDia = "";
  return (
    <div
      ref={scrollRef}
      className="flex h-[52vh] flex-col gap-2 overflow-y-auto rounded-[16px] border border-[#E6EAF4] bg-[#F4F6FB] p-3.5"
    >
      {/* Historial: mensajes viejos, plegados por defecto. */}
      {ocultos > 0 && (
        <div className="flex justify-center py-0.5">
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="rounded-full bg-white px-3 py-1 text-[11.5px] font-bold text-azul shadow-[0_1px_2px_rgba(26,34,71,0.06)]"
          >
            {verHistorial ? "Ocultar historial" : `Ver historial (${ocultos} mensaje${ocultos === 1 ? "" : "s"} anterior${ocultos === 1 ? "" : "es"})`}
          </button>
        </div>
      )}
      {visibles.map((m) => {
        const dia = etiquetaDia(m.creado_en);
        const nuevoDia = dia !== ultimoDia;
        ultimoDia = dia;
        return (
          <div key={m.id} className="flex flex-col">
            {nuevoDia && (
              <div className="my-1.5 flex justify-center">
                <span className="rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-bold text-[#8A93AD] shadow-[0_1px_2px_rgba(26,34,71,0.06)]">
                  {dia}
                </span>
              </div>
            )}
            <div className={`flex items-end gap-2 ${m.esMio ? "flex-row-reverse" : ""}`}>
              {!m.esMio && (
                <span
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                  style={{ background: colorDe(m.autorNombre) }}
                  title={m.autorNombre}
                >
                  {iniciales(m.autorNombre)}
                </span>
              )}
              <div
                className={`flex max-w-[80%] flex-col gap-0.5 rounded-[16px] px-3 py-2 ${
                  m.esMio
                    ? "rounded-br-[4px] bg-[#2453DC] text-white"
                    : "rounded-bl-[4px] bg-white text-tinta shadow-[0_1px_2px_rgba(26,34,71,0.07)]"
                }`}
              >
                {!m.esMio && (
                  <span className="text-[11px] font-bold" style={{ color: colorDe(m.autorNombre) }}>
                    {m.autorNombre}
                  </span>
                )}
                <span className="text-[14px] leading-snug break-words whitespace-pre-wrap">{m.cuerpo}</span>
                <span className={`self-end text-[10px] font-medium ${m.esMio ? "text-white/60" : "text-[#AEB6CC]"}`}>
                  {horaDe(m.creado_en)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={finRef} />
    </div>
  );
}

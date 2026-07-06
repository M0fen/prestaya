"use client";
// Panel de control de la ZONA DE JUEGO (gestor). Enciende/apaga la zona, elige
// el juego arcade del mes, la meta de racha, el premio y los mensajes. Guarda
// por Server Action y refresca.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarAjustesJuego } from "@/lib/acciones/juego";
import type { AjustesJuego } from "@/lib/juegoAjustes";

export function FormAjustesJuego({
  inicial,
  juegos,
}: {
  inicial: AjustesJuego;
  juegos: { id: string; titulo: string }[];
}) {
  const router = useRouter();
  const [a, setA] = useState<AjustesJuego>(inicial);
  const [pendiente, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const set = <K extends keyof AjustesJuego>(k: K, v: AjustesJuego[K]) =>
    setA((prev) => ({ ...prev, [k]: v }));

  const guardar = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await guardarAjustesJuego(a);
      if (res.ok) {
        setMsg({ ok: true, texto: "Guardado ✓" });
        router.refresh();
      } else {
        setMsg({ ok: false, texto: res.error });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      {/* Encendido */}
      <Toggle
        label="Zona de juego encendida"
        sub="Si la apagás, los clientes no ven la zona de juego, misiones ni el arcade."
        valor={a.activo}
        onChange={(v) => set("activo", v)}
      />

      <div className={a.activo ? "flex flex-col gap-4" : "flex flex-col gap-4 opacity-50"}>
        {/* Juego del mes */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-tinta">Juego del mes</span>
          <select
            value={a.juegoActivo}
            disabled={!a.activo}
            onChange={(e) => set("juegoActivo", e.target.value)}
            className="rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[14px] outline-none focus:border-azul"
          >
            {juegos.map((j) => (
              <option key={j.id} value={j.id}>
                {j.titulo}
              </option>
            ))}
          </select>
        </label>

        {/* Meta de racha */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-tinta">Meta de racha (misión principal)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={a.metaRacha}
            disabled={!a.activo}
            onChange={(e) => set("metaRacha", Number(e.target.value))}
            className="w-28 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
        </label>

        {/* Premio */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-tinta">Premio al lograr la racha</span>
          <input
            type="text"
            value={a.premioMeta}
            disabled={!a.activo}
            maxLength={200}
            onChange={(e) => set("premioMeta", e.target.value)}
            className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
        </label>

        {/* Mensaje de bienvenida */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-bold text-tinta">Mensaje de aliento</span>
          <input
            type="text"
            value={a.mensajeBienvenida}
            disabled={!a.activo}
            maxLength={200}
            onChange={(e) => set("mensajeBienvenida", e.target.value)}
            className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
        </label>

        <Toggle
          label="Mostrar misiones"
          sub="Las barras de progreso (racha, semana al día, crédito al 100%)."
          valor={a.mostrarMisiones}
          onChange={(v) => set("mostrarMisiones", v)}
          disabled={!a.activo}
        />

        {/* Temporada / evento del mes */}
        <div className="rounded-[12px] border border-[#EEF1F8] bg-[#F7F9FD] p-3">
          <Toggle
            label="Temporada / evento del mes"
            sub="Un tema con meta colectiva y premio, visible para los clientes."
            valor={a.temporadaActiva}
            onChange={(v) => set("temporadaActiva", v)}
            disabled={!a.activo}
          />
          {a.temporadaActiva && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[11.5px] font-bold text-tinta">Nombre del evento</span>
                  <input
                    type="text" value={a.temporadaNombre} maxLength={40} disabled={!a.activo}
                    onChange={(e) => set("temporadaNombre", e.target.value)}
                    placeholder="Mundial 2026"
                    className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
                  />
                </label>
                <label className="flex w-20 flex-col gap-1">
                  <span className="text-[11.5px] font-bold text-tinta">Emoji</span>
                  <input
                    type="text" value={a.temporadaEmoji} maxLength={4} disabled={!a.activo}
                    onChange={(e) => set("temporadaEmoji", e.target.value)}
                    className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-center text-[16px] outline-none focus:border-azul"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-bold text-tinta">Meta colectiva (% de clientes al día)</span>
                <input
                  type="number" min={1} max={100} value={a.temporadaMeta} disabled={!a.activo}
                  onChange={(e) => set("temporadaMeta", Number(e.target.value))}
                  className="w-28 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-bold text-tinta">Premio si llegan a la meta</span>
                <input
                  type="text" value={a.temporadaPremio} maxLength={120} disabled={!a.activo}
                  onChange={(e) => set("temporadaPremio", e.target.value)}
                  placeholder="Sorteo de una camiseta"
                  className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Config del cliente que aplica SIEMPRE (aunque la zona de juego esté
          apagada): estrellas y caritas se muestran igual. */}
      <div className="flex flex-col gap-3 rounded-[12px] border border-[#EEF1F8] bg-[#F7F9FD] p-3">
        <span className="text-[12px] font-extrabold text-tinta">Vista del cliente</span>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-bold text-tinta">Ciclo del canje de estrellas</span>
          <span className="text-[11px] font-medium text-gris">
            Cada cuánto se reinicia el tope de 5 estrellas por canje.
          </span>
          <select
            value={a.estrellasCiclo}
            onChange={(e) => set("estrellasCiclo", e.target.value as AjustesJuego["estrellasCiclo"])}
            className="mt-1 w-56 rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[14px] outline-none focus:border-azul"
          >
            <option value="mes">Por mes calendario</option>
            <option value="credito">Por crédito</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-bold text-tinta">
            Umbral de la carita roja (días de atraso)
          </span>
          <span className="text-[11px] font-medium text-gris">
            Con esta cantidad de cuotas vencidas, la carita del cliente pasa de naranja a roja.
          </span>
          <input
            type="number"
            min={1}
            max={60}
            value={a.umbralCaritas}
            onChange={(e) => set("umbralCaritas", Number(e.target.value))}
            className="mt-1 w-28 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="rounded-full bg-[#2453DC] px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {pendiente ? "Guardando…" : "Guardar cambios"}
        </button>
        {msg && (
          <span
            className={`text-[12.5px] font-bold ${msg.ok ? "text-[#157A50]" : "text-[#C0392B]"}`}
          >
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  sub,
  valor,
  onChange,
  disabled,
}: {
  label: string;
  sub?: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!valor)}
      disabled={disabled}
      className="flex items-center justify-between gap-3 text-left disabled:opacity-50"
    >
      <div className="flex flex-col">
        <span className="text-[13px] font-bold text-tinta">{label}</span>
        {sub && <span className="text-[11.5px] font-medium text-gris">{sub}</span>}
      </div>
      <span
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          valor ? "bg-[#1FA971]" : "bg-[#CBD3E6]"
        }`}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          style={{ transform: valor ? "translateX(22px)" : "translateX(2px)" }}
        />
      </span>
    </button>
  );
}

"use client";
// Gestor de RECOMPENSAS del gaming. Lista los premios, permite activar/desactivar
// y borrar, y crear nuevos ligados a un hito de pago. Los clientes los ven en su
// cofre y se desbloquean solos con su comportamiento real.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  agregarRecompensa,
  alternarRecompensa,
  eliminarRecompensa,
} from "@/lib/acciones/recompensas";
import type { HitoTipo } from "@/lib/recompensas";
import type { RecompensaAdmin } from "@/lib/data/recompensas";

const HITOS: { id: HitoTipo; label: string; usaValor: boolean }[] = [
  { id: "racha", label: "Racha de N días", usaValor: true },
  { id: "mes_al_dia", label: "Mes sin atrasos", usaValor: false },
  { id: "credito_completo", label: "Crédito al 100%", usaValor: false },
  { id: "nivel", label: "Llegar a nivel (0–4)", usaValor: true },
];

function etiquetaHito(tipo: HitoTipo, valor: number): string {
  if (tipo === "racha") return `Racha de ${valor} días`;
  if (tipo === "nivel") return `Nivel ${valor}`;
  if (tipo === "mes_al_dia") return "Mes sin atrasos";
  return "Crédito al 100%";
}

export function RecompensasManager({ recompensas }: { recompensas: RecompensaAdmin[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [titulo, setTitulo] = useState("");
  const [premio, setPremio] = useState("");
  const [hito, setHito] = useState<HitoTipo>("racha");
  const [valor, setValor] = useState("10");

  const usaValor = HITOS.find((h) => h.id === hito)?.usaValor ?? false;

  const crear = () => {
    setError(null);
    startTransition(async () => {
      const res = await agregarRecompensa({
        titulo, premio, hitoTipo: hito,
        hitoValor: usaValor ? Number(valor) || 0 : 0,
        orden: recompensas.length + 1,
      });
      if (res.ok) { setTitulo(""); setPremio(""); router.refresh(); }
      else setError(res.error);
    });
  };

  const toggle = (id: string, activo: boolean) =>
    startTransition(async () => { await alternarRecompensa(id, activo); router.refresh(); });
  const borrar = (id: string) =>
    startTransition(async () => { await eliminarRecompensa(id); router.refresh(); });

  return (
    <section className="flex flex-col gap-4 rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-extrabold text-tinta">Recompensas</span>
        <span className="text-[12px] font-medium text-gris">
          Premios que el cliente desbloquea al cumplir hitos de pago.
        </span>
      </div>

      {/* Lista */}
      {recompensas.length > 0 && (
        <ul className="flex flex-col divide-y divide-[#EEF1F8]">
          {recompensas.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-bold text-tinta">{r.titulo}</span>
                <span className="truncate text-[11.5px] font-medium text-gris">
                  {etiquetaHito(r.hitoTipo, r.hitoValor)} · 🎁 {r.premio}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggle(r.id, !r.activo)}
                disabled={pendiente}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  r.activo ? "bg-[#E4F5EC] text-[#157A50]" : "bg-[#EEF1F8] text-gris"
                }`}
              >
                {r.activo ? "Activa" : "Oculta"}
              </button>
              <button
                type="button"
                onClick={() => borrar(r.id)}
                disabled={pendiente}
                aria-label="Borrar"
                className="rounded-full border border-[#F0D2CE] px-2.5 py-1 text-[11px] font-bold text-[#C0392B]"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Alta */}
      <div className="flex flex-col gap-2.5 rounded-[12px] bg-[#F7F9FD] p-3">
        <span className="text-[12px] font-bold text-tinta">Nueva recompensa</span>
        <input
          value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={60}
          placeholder="Título (ej. Racha de 15)"
          className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
        />
        <input
          value={premio} onChange={(e) => setPremio(e.target.value)} maxLength={120}
          placeholder="Premio (ej. Descuento en tu próximo crédito)"
          className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
        />
        <div className="flex gap-2">
          <select
            value={hito} onChange={(e) => setHito(e.target.value as HitoTipo)}
            className="flex-1 rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          >
            {HITOS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
          {usaValor && (
            <input
              inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, ""))}
              className="w-20 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-center text-[14px] tabular-nums outline-none focus:border-azul"
              aria-label="Valor del hito"
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={crear}
            disabled={pendiente || !titulo.trim() || !premio.trim()}
            className="rounded-full bg-[#2453DC] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {pendiente ? "…" : "Agregar recompensa"}
          </button>
          {error && <span className="text-[12px] font-bold text-[#C0392B]">{error}</span>}
        </div>
      </div>
    </section>
  );
}

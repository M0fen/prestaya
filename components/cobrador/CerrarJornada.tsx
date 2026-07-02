"use client";
// Cierre de jornada del cobrador (rendición). Muestra lo RECAUDADO (del
// servidor), pide gastos de ruta + efectivo entregado, calcula en vivo la
// diferencia (cuadra / faltante / sobrante) y cierra por Server Action. Una vez
// cerrada, muestra el resumen. Mobile-first.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularRendicion, ETIQUETA_ESTADO, type EstadoRendicion } from "@/lib/rendicion";
import { cerrarJornada } from "@/lib/acciones/rendicion";
import type { RendicionDia } from "@/lib/data/rendicion";

const TONO: Record<EstadoRendicion, { bg: string; fg: string }> = {
  cuadra: { bg: "#E4F5EC", fg: "#157A50" },
  faltante: { bg: "#FBE4E2", fg: "#C0392B" },
  sobrante: { bg: "#FDF3E2", fg: "#B9770E" },
};

export function CerrarJornada({
  recaudado,
  cobrosCantidad,
  gastosHoy = 0,
  yaRendida,
  disponible,
}: {
  recaudado: number;
  cobrosCantidad: number;
  gastosHoy?: number;
  yaRendida: RendicionDia | null;
  disponible: boolean;
}) {
  const router = useRouter();
  // Prellena los gastos con lo que el cobrador ya cargó hoy (puede ajustarlo).
  const [gastos, setGastos] = useState(gastosHoy > 0 ? String(gastosHoy) : "");
  const [entregado, setEntregado] = useState(String(Math.max(0, recaudado - gastosHoy)));
  const [notas, setNotas] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (!disponible) return null; // se habilita al correr 0013

  // Ya cerró: resumen de solo lectura.
  if (yaRendida) {
    const t = TONO[yaRendida.estado];
    return (
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-extrabold text-tinta">Jornada cerrada ✓</span>
          <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {ETIQUETA_ESTADO[yaRendida.estado]}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <Fila k="Recaudado" v={UYU(yaRendida.recaudado)} />
          <Fila k="Gastos de ruta" v={UYU(yaRendida.gastos)} />
          <Fila k="A entregar" v={UYU(yaRendida.recaudado - yaRendida.gastos)} />
          <Fila k="Entregado" v={UYU(yaRendida.entregado)} />
        </div>
        {yaRendida.diferencia !== 0 && (
          <div className="mt-2 rounded-[10px] px-3 py-2 text-[12.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {yaRendida.diferencia < 0 ? "Faltante" : "Sobrante"} de {UYU(Math.abs(yaRendida.diferencia))}
          </div>
        )}
      </section>
    );
  }

  const gastosN = Math.max(0, Math.round(Number(gastos) || 0));
  const entregadoN = Math.max(0, Math.round(Number(entregado) || 0));
  const { esperado, diferencia, estado } = calcularRendicion(recaudado, gastosN, entregadoN);
  const t = TONO[estado];

  const cerrar = () => {
    setError(null);
    startTransition(async () => {
      const res = await cerrarJornada({ gastos: gastosN, entregado: entregadoN, notas });
      if (res.ok) {
        setConfirmar(false);
        router.refresh();
      } else {
        setError(res.error);
        setConfirmar(false);
      }
    });
  };

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <span className="text-[14px] font-extrabold text-tinta">Cerrar jornada</span>

      <div className="mt-2 flex items-end justify-between rounded-[12px] bg-[#F4F6FB] px-3 py-2.5">
        <span className="text-[12px] font-semibold text-gris">Recaudado hoy</span>
        <span className="text-[18px] font-black tabular-nums text-verde">
          {UYU(recaudado)}
          <span className="ml-1 text-[11px] font-semibold text-gris">· {cobrosCantidad} cobro{cobrosCantidad === 1 ? "" : "s"}</span>
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Campo label="Gastos de ruta">
          <input
            inputMode="numeric"
            value={gastos}
            onChange={(e) => setGastos(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className="w-full rounded-[11px] border border-[#DCE3F4] px-3 py-2 text-[15px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
        <Campo label="Efectivo que entrego">
          <input
            inputMode="numeric"
            value={entregado}
            onChange={(e) => setEntregado(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className="w-full rounded-[11px] border border-[#DCE3F4] px-3 py-2 text-[15px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
      </div>
      {gastosHoy > 0 && (
        <p className="mt-1.5 px-1 text-[11px] font-medium text-[#8A93AD]">
          Incluye {UYU(gastosHoy)} de gastos que cargaste hoy. Podés ajustarlo.
        </p>
      )}

      {/* A entregar + diferencia en vivo */}
      <div className="mt-2.5 flex items-center justify-between rounded-[12px] px-3 py-2.5" style={{ background: t.bg }}>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold" style={{ color: t.fg }}>Debería entregar</span>
          <span className="text-[15px] font-extrabold tabular-nums" style={{ color: t.fg }}>{UYU(esperado)}</span>
        </div>
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-[12px] font-black" style={{ color: t.fg }}>
          {estado === "cuadra" ? "Cuadra ✓" : `${estado === "faltante" ? "Falta" : "Sobra"} ${UYU(Math.abs(diferencia))}`}
        </span>
      </div>

      <input
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        maxLength={300}
        placeholder="Nota (opcional): motivo del faltante, etc."
        className="mt-2.5 w-full rounded-[11px] border border-[#DCE3F4] px-3 py-2 text-[13.5px] outline-none focus:border-azul"
      />

      {error && <p className="mt-2 text-[12px] font-semibold text-[#C0392B]">{error}</p>}

      {!confirmar ? (
        <button
          type="button"
          onClick={() => setConfirmar(true)}
          className="mt-3 w-full rounded-[13px] bg-[#2453DC] py-3 text-[15px] font-extrabold text-white active:scale-[0.99]"
        >
          Cerrar jornada
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-center text-[12.5px] font-semibold text-gris">
            Vas a rendir {UYU(entregadoN)}. El cierre no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(false)}
              disabled={pendiente}
              className="flex-1 rounded-[13px] border border-[#DCE3F4] py-3 text-[14px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={pendiente}
              className="flex-1 rounded-[13px] bg-[#1FA971] py-3 text-[14px] font-extrabold text-white disabled:opacity-60"
            >
              {pendiente ? "Cerrando…" : "Confirmar cierre"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-bold text-gris">{label}</span>
      {children}
    </label>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] bg-[#F7F9FD] px-2.5 py-1.5">
      <span className="text-[11.5px] font-medium text-gris">{k}</span>
      <span className="text-[13px] font-extrabold tabular-nums text-tinta">{v}</span>
    </div>
  );
}

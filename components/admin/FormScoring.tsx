"use client";
// Ajuste del MODELO de scoring (solo admin). Pesos de los 5 factores (se
// normalizan a 100%) + umbrales de banda. Muestra el % efectivo en vivo.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarConfigScoring } from "@/lib/acciones/scoringConfig";
import type { ConfigScoring } from "@/lib/scoring";

const FACTORES: { clave: keyof ConfigScoring["pesos"]; label: string; hint: string }[] = [
  { clave: "cumplimiento", label: "Cumplimiento de pago", hint: "% de lo exigible que pagó" },
  { clave: "moraActual", label: "Mora actual", hint: "atraso en el crédito vigente" },
  { clave: "experiencia", label: "Experiencia", hint: "créditos ya finalizados" },
  { clave: "consistencia", label: "Consistencia", hint: "días pagados puntuales" },
  { clave: "antiguedad", label: "Antigüedad", hint: "meses como cliente" },
];

export function FormScoring({ inicial }: { inicial: ConfigScoring }) {
  const router = useRouter();
  // Los pesos se muestran como "puntos" (×100) para que sea intuitivo.
  const [pesos, setPesos] = useState<Record<string, number>>({
    cumplimiento: Math.round(inicial.pesos.cumplimiento * 100),
    moraActual: Math.round(inicial.pesos.moraActual * 100),
    experiencia: Math.round(inicial.pesos.experiencia * 100),
    consistencia: Math.round(inicial.pesos.consistencia * 100),
    antiguedad: Math.round(inicial.pesos.antiguedad * 100),
  });
  const [umb, setUmb] = useState({
    excelente: inicial.umbrales.excelente,
    bueno: inicial.umbrales.bueno,
    regular: inicial.umbrales.regular,
  });
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const suma = Object.values(pesos).reduce((s, v) => s + (v || 0), 0);
  const pct = (v: number) => (suma > 0 ? Math.round((v / suma) * 100) : 0);
  const umbOk = umb.excelente > umb.bueno && umb.bueno > umb.regular;

  const guardar = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await guardarConfigScoring({
        pesos: {
          cumplimiento: pesos.cumplimiento,
          moraActual: pesos.moraActual,
          experiencia: pesos.experiencia,
          consistencia: pesos.consistencia,
          antiguedad: pesos.antiguedad,
        },
        umbrales: umb,
      });
      if (res.ok) {
        setMsg({ ok: true, texto: "Guardado ✓ — se recalcula a todos" });
        router.refresh();
      } else setMsg({ ok: false, texto: res.error });
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-[16px] border border-borde bg-tarjeta p-4">
      {/* Pesos */}
      <div className="flex flex-col gap-3">
        <span className="text-[12px] font-extrabold text-tinta">Peso de cada factor</span>
        {FACTORES.map((f) => (
          <div key={f.clave} className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] font-bold text-tinta">{f.label}</span>
              <span className="text-[11px] font-medium text-gris">{f.hint}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pesos[f.clave]}
              onChange={(e) => setPesos((p) => ({ ...p, [f.clave]: Number(e.target.value) }))}
              className="w-28 accent-[#2453DC]"
            />
            <span className="w-10 text-right text-[13px] font-extrabold tabular-nums text-azul">
              {pct(pesos[f.clave])}%
            </span>
          </div>
        ))}
        <span className="text-[11px] font-medium text-tenue">
          Los pesos se normalizan a 100% al guardar. Suma actual: {suma} (se reparte proporcional).
        </span>
      </div>

      {/* Umbrales */}
      <div className="flex flex-col gap-2 border-t border-linea pt-3">
        <span className="text-[12px] font-extrabold text-tinta">Umbrales de banda (0–1000)</span>
        <div className="grid grid-cols-3 gap-2.5">
          <Campo label="Excelente ≥" valor={umb.excelente} onChange={(v) => setUmb((u) => ({ ...u, excelente: v }))} />
          <Campo label="Bueno ≥" valor={umb.bueno} onChange={(v) => setUmb((u) => ({ ...u, bueno: v }))} />
          <Campo label="Regular ≥" valor={umb.regular} onChange={(v) => setUmb((u) => ({ ...u, regular: v }))} />
        </div>
        {!umbOk && (
          <span className="text-[11px] font-semibold text-[#C0392B]">
            Deben ir de mayor a menor: excelente &gt; bueno &gt; regular.
          </span>
        )}
        <span className="text-[11px] font-medium text-tenue">
          Debajo de “Regular” el cliente cae en <b>riesgo</b>. Con poco historial queda “nuevo”.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente || !umbOk || suma <= 0}
          className="btn-primario px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {pendiente ? "Guardando…" : "Guardar modelo"}
        </button>
        {msg && (
          <span className={`text-[12.5px] font-bold ${msg.ok ? "text-[#157A50]" : "text-[#C0392B]"}`}>
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  );
}

function Campo({ label, valor, onChange }: { label: string; valor: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-gris">{label}</span>
      <input
        inputMode="numeric"
        value={valor}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        className="rounded-[12px] border border-borde px-2.5 py-2 text-[14px] tabular-nums outline-none focus:border-azul"
      />
    </label>
  );
}

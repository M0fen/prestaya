"use client";
// Política de mora (recargo por atraso), editable por el gestor. Colapsable
// para no cargar la vista. El recargo se calcula aparte: NO altera el cartón.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describirMora, type ConfigMora, type ModoMora } from "@/lib/moraCargo";
import { guardarConfigMora } from "@/lib/acciones/moraConfig";

const MODOS: { id: ModoMora; label: string; hint: string }[] = [
  { id: "off", label: "Sin mora", hint: "No se aplica recargo" },
  { id: "fijo", label: "$ por cuota", hint: "Monto fijo por cuota vencida" },
  { id: "pct", label: "% del vencido", hint: "Porcentaje de la deuda vencida" },
];

export function FormPoliticaMora({
  config,
  puedeEditar = true,
}: {
  config: ConfigMora;
  /** Solo el admin edita la política; el supervisor la ve en modo lectura. */
  puedeEditar?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<ModoMora>(config.modo);
  const [valor, setValor] = useState(String(config.valor));
  const [gracia, setGracia] = useState(String(config.cuotasGracia));
  const [tope, setTope] = useState(String(config.topePct));
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  // Supervisor: solo lectura de la política vigente (sin poder cambiarla).
  if (!puedeEditar) {
    return (
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-extrabold text-tinta">Política de mora</span>
            <span className="truncate text-[12px] font-medium text-gris">{describirMora(config)}</span>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#F1F3F9] px-3 py-1.5 text-[11.5px] font-bold text-tenue">
            Solo administrador
          </span>
        </div>
      </section>
    );
  }

  const guardar = () => {
    setError(null); setOkMsg(null);
    startTransition(async () => {
      const res = await guardarConfigMora({
        modo,
        valor: Number(valor) || 0,
        cuotasGracia: Number(gracia) || 0,
        topePct: Number(tope) || 0,
      });
      if (res.ok) { setOkMsg("Guardado ✓"); router.refresh(); }
      else setError(res.error);
    });
  };

  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-extrabold text-tinta">Política de mora</span>
          <span className="truncate text-[12px] font-medium text-gris">{describirMora(config)}</span>
        </div>
        <span className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul">
          {abierto ? "Cerrar" : "Configurar"}
        </span>
      </button>

      {abierto && (
        <div className="mt-3.5 flex flex-col gap-3 border-t border-linea pt-3.5">
          <div className="grid grid-cols-3 gap-2">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModo(m.id)}
                className={`flex flex-col gap-0.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                  modo === m.id ? "border-azul bg-[#EEF3FF]" : "border-[#E3EAFB] bg-tarjeta"
                }`}
              >
                <span className="text-[12.5px] font-bold text-tinta">{m.label}</span>
                <span className="text-[10.5px] font-medium text-gris">{m.hint}</span>
              </button>
            ))}
          </div>

          {modo !== "off" && (
            <div className="grid grid-cols-3 gap-2.5">
              <Campo label={modo === "fijo" ? "Monto ($)" : "Porcentaje (%)"}>
                <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ""))}
                  className="w-full rounded-[10px] border border-borde px-2.5 py-2 text-[14px] tabular-nums outline-none focus:border-azul" />
              </Campo>
              <Campo label="Cuotas de gracia">
                <input inputMode="numeric" value={gracia} onChange={(e) => setGracia(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full rounded-[10px] border border-borde px-2.5 py-2 text-[14px] tabular-nums outline-none focus:border-azul" />
              </Campo>
              <Campo label="Tope (% vencido)">
                <input inputMode="decimal" value={tope} onChange={(e) => setTope(e.target.value.replace(/[^\d.]/g, ""))}
                  className="w-full rounded-[10px] border border-borde px-2.5 py-2 text-[14px] tabular-nums outline-none focus:border-azul" />
              </Campo>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={guardar}
              disabled={pendiente}
              className="rounded-[11px] bg-[#2453DC] px-4 py-2 text-[13px] font-extrabold text-white disabled:opacity-60"
            >
              {pendiente ? "Guardando…" : "Guardar política"}
            </button>
            {okMsg && <span className="text-[12px] font-bold text-verde">{okMsg}</span>}
            {error && <span className="text-[12px] font-bold text-[#C0392B]">{error}</span>}
          </div>

          <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
            El recargo se calcula aparte y no modifica el cartón del cliente. El tope ayuda a mantenerlo
            dentro de lo razonable (ley de usura 18.212). Cobrarlo o no queda a criterio del equipo.
          </p>
        </div>
      )}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-gris">{label}</span>
      {children}
    </label>
  );
}

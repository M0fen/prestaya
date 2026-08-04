"use client";
// ─────────────────────────────────────────────────────────────────────────
//  PRESUPUESTO DE JUEGOS (0130) — la pantalla que faltaba: cuánto se está
//  gastando en premios y cuánto va a costar lo que estoy por regalar.
//
//  Tres bloques, en el orden en que el dueño los necesita:
//   1. GASTO REAL: hoy / 7 días / mes / año, con el semáforo del tope.
//   2. SIMULADOR: "si regalo N raspaditas de este tramo, ¿cuánto dejo en la
//      calle?" — antes de confirmar, no después.
//   3. PRECIO DE CADA PREMIO: sin esto, todo lo de arriba da $0.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { UYU } from "@/lib/format";
import { simularRegalo, semaforo, proyectarMes, type CostoTramo, type GastoPeriodo } from "@/lib/presupuestoJuegos";
import { setTopeMensualJuegos } from "@/lib/acciones/presupuestoJuegos";

interface Props {
  periodos: GastoPeriodo[];
  tramos: CostoTramo[];
  topeMensual: number;
  premiosSinCosto: string[];
  /** Día del mes y días del mes, para proyectar el cierre. */
  diaDelMes: number;
  diasDelMes: number;
  esAdmin: boolean;
}

const COLOR: Record<string, string> = {
  ok: "text-verde-osc",
  cerca: "text-ambar-osc",
  excedido: "text-rojo-osc",
  "sin-tope": "text-gris",
};

export function PresupuestoJuegos({
  periodos,
  tramos,
  topeMensual,
  premiosSinCosto,
  diaDelMes,
  diasDelMes,
  esAdmin,
}: Props) {
  const mes = periodos.find((p) => p.etiqueta === "Este mes");
  const sem = semaforo(mes?.total ?? 0, topeMensual);
  const proyeccion = proyectarMes(mes?.total ?? 0, diaDelMes, diasDelMes);

  return (
    <section className="flex flex-col gap-4 rounded-[20px] bg-white p-4 shadow-[0_2px_14px_rgba(19,48,140,0.06)]">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-[16px] font-extrabold tracking-[-0.01em] text-tinta">Presupuesto de premios</h2>
        <p className="text-[12px] leading-[1.5] font-medium text-gris">
          Cuánto cuestan de verdad las raspaditas, quinielas y rifas. El costo de cada premio lo
          ponés vos abajo: es lo que a la empresa le cuesta ese beneficio (un día de gracia ≈ un día
          de interés; un 5% ≈ 5% de la cuota).
        </p>
      </header>

      {premiosSinCosto.length > 0 && (
        <p className="rounded-[14px] bg-ambar-suave p-3 text-[12px] leading-[1.5] font-semibold text-ambar-osc">
          ⚠️ {premiosSinCosto.length} premio(s) activos sin costo cargado ({premiosSinCosto.slice(0, 3).join(", ")}
          {premiosSinCosto.length > 3 ? "…" : ""}). Mientras estén en $0, todo lo de esta pantalla se
          queda corto: cargá cuánto te cuesta cada uno.
        </p>
      )}

      {/* ── 1. GASTO REAL ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        {periodos.map((p) => (
          <div key={p.etiqueta} className="rounded-[16px] bg-fondo p-3">
            <div className="text-[11px] font-bold tracking-wide text-gris uppercase">{p.etiqueta}</div>
            <div className="mt-0.5 text-[20px] font-extrabold tabular-nums tracking-[-0.02em] text-tinta">
              {UYU(p.total)}
            </div>
            <div className="mt-1 text-[11px] leading-[1.45] font-medium text-tenue-2">
              {p.raspaditas > 0 && <span>{p.raspaditas} raspadita(s) · </span>}
              {p.quinielas > 0 && <span>{p.quinielas} quiniela(s) · </span>}
              {p.rifas > 0 && <span>{p.rifas} rifa(s) · </span>}
              {p.estrellas > 0 && <span>{p.estrellas} canje(s)</span>}
              {p.total === 0 && <span>Sin premios entregados</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-[16px] bg-fondo p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-tinta">Tope del mes</span>
          <span className={`text-[12px] font-bold ${COLOR[sem.estado]}`}>{sem.mensaje}</span>
        </div>
        {topeMensual > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-[#EEF1F8]">
            <div
              className={`h-full rounded-full ${
                sem.estado === "excedido" ? "bg-rojo" : sem.estado === "cerca" ? "bg-ambar" : "bg-verde"
              }`}
              style={{ width: `${Math.min(100, sem.usadoPct)}%` }}
            />
          </div>
        )}
        <p className="text-[11.5px] leading-[1.5] font-medium text-tenue-2">
          Al ritmo de este mes vas a cerrar en <b className="text-tinta">{UYU(proyeccion)}</b>.
        </p>
        {esAdmin && <FormTope inicial={topeMensual} />}
      </div>

      {/* ── 2. SIMULADOR ──────────────────────────────────────────────── */}
      <Simulador tramos={tramos} />
    </section>
  );
}

function FormTope({ inicial }: { inicial: number }) {
  const [valor, setValor] = useState(String(inicial || ""));
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, start] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      action={() =>
        start(async () => {
          const r = await setTopeMensualJuegos(Number(valor) || 0);
          setMsg(r.ok ? "Guardado ✓" : r.error);
        })
      }
    >
      <span className="text-[12px] font-medium text-gris">$</span>
      <input
        inputMode="numeric"
        value={valor}
        onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
        placeholder="0 = sin tope"
        aria-label="Tope mensual de gasto en premios"
        className="h-11 min-w-0 flex-1 rounded-[12px] border border-[#E3E8F4] px-3 text-[16px] font-semibold tabular-nums text-tinta"
      />
      <button
        type="submit"
        disabled={pend}
        className="h-11 shrink-0 rounded-[12px] bg-azul px-4 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {pend ? "…" : "Fijar tope"}
      </button>
      {msg && <span className="text-[11.5px] font-semibold text-gris">{msg}</span>}
    </form>
  );
}

function Simulador({ tramos }: { tramos: CostoTramo[] }) {
  const [cantidad, setCantidad] = useState("100");
  const [tramoId, setTramoId] = useState(tramos[0]?.segmentoId ?? "");
  const tramo = tramos.find((t) => t.segmentoId === tramoId) ?? tramos[0];
  const sim = useMemo(
    () => (tramo ? simularRegalo(Number(cantidad) || 0, tramo) : null),
    [cantidad, tramo],
  );

  if (!tramo || !sim) {
    return (
      <p className="rounded-[14px] bg-fondo p-3 text-[12px] font-medium text-gris">
        Todavía no hay tramos de raspadita configurados, así que no hay nada que simular.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-[#E3E8F4] p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[14px] font-extrabold text-tinta">Antes de regalar: ¿cuánto dejo en la calle?</h3>
        <p className="text-[11.5px] leading-[1.5] font-medium text-gris">
          Simulá una entrega antes de hacerla. La cuenta es la misma que usa el servidor para
          sortear.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          inputMode="numeric"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
          aria-label="Cantidad de raspaditas a entregar"
          className="h-11 w-24 rounded-[12px] border border-[#E3E8F4] px-3 text-[16px] font-semibold tabular-nums text-tinta"
        />
        <span className="text-[12.5px] font-medium text-gris">raspaditas a clientes de</span>
        <select
          value={tramoId}
          onChange={(e) => setTramoId(e.target.value)}
          aria-label="Tramo de clientes"
          className="h-11 min-w-0 flex-1 rounded-[12px] border border-[#E3E8F4] px-3 text-[16px] font-semibold text-tinta"
        >
          {tramos.map((t) => (
            <option key={t.segmentoId} value={t.segmentoId}>
              {t.nombre} ({t.probGanar}% gana)
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Dato titulo="Lo más probable" valor={UYU(sim.costoEsperado)} destacado />
        <Dato titulo="Si hay mala suerte" valor={UYU(sim.costoPeorCaso)} />
        <Dato titulo="Van a ganar" valor={`${sim.ganadoresEsperados}`} />
      </div>

      <p className="text-[11.5px] leading-[1.55] font-medium text-tenue-2">
        Cada jugada de este tramo cuesta <b className="text-tinta">{UYU(tramo.costoEsperado)}</b> en
        promedio ({tramo.probGanar}% de chance de ganar; si gana, el premio vale{" "}
        {UYU(tramo.costoSiGana)} en promedio y como máximo {UYU(tramo.costoMaximo)}).
      </p>

      {sim.avisos.map((a) => (
        <p key={a} className="rounded-[12px] bg-ambar-suave p-2.5 text-[11.5px] leading-[1.5] font-semibold text-ambar-osc">
          ⚠️ {a}
        </p>
      ))}
    </div>
  );
}

function Dato({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded-[14px] p-2.5 ${destacado ? "bg-azul-suave" : "bg-fondo"}`}>
      <div className="text-[10.5px] font-bold tracking-wide text-gris uppercase">{titulo}</div>
      <div
        className={`mt-0.5 text-[16px] font-extrabold tabular-nums tracking-[-0.02em] ${
          destacado ? "text-azul" : "text-tinta"
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

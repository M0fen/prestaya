"use client";
// ─────────────────────────────────────────────────────────────────────────
//  JORNADAS ABIERTAS — el efectivo que el cobrador tiene encima sin acta.
//
//  El agujero más caro del piloto: la app solo sabe cerrar el día de HOY. Si al
//  cobrador se le pasó la noche, esa jornada queda incerrable para siempre y el
//  supervisor no tiene dónde anotar que recibió la plata. 40 jornadas abiertas de
//  19 cobradores, $2.702.391, la más vieja del 10 de julio.
//
//  La plata NO está perdida: el libro de pagos la tiene toda. Lo que falta es el
//  papel — sin acta, ni el cobrador puede probar que entregó ni la oficina que
//  recibió, y la alerta de "sin rendir" queda encendida hasta que se deja de mirar.
//
//  Reglas de esta pantalla, todas por la misma razón (acá se sella plata ajena):
//   · Lo VIEJO arriba. Es el orden de la urgencia y es lo que se olvida.
//   · El "debería entregar" lo calcula el SERVIDOR con los datos de ESE día; acá
//     solo se declara cuánto se recibió, que es lo único que el sistema no sabe.
//   · La cuenta se muestra DESGLOSADA: base + cobró − gastos − colocó. Sin verla,
//     el supervisor no puede discutir un número con el cobrador enfrente.
//   · Dos toques para confirmar, y la diferencia a la vista ANTES de sellar.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { registrarEntregaDiferida } from "@/lib/acciones/rendicion";
import type { JornadaAbierta } from "@/lib/data/rendicion";

function fechaCorta(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return d && m ? `${d}/${m}` : ymd;
}

export function JornadasSinRendir({ jornadas }: { jornadas: JornadaAbierta[] }) {
  if (jornadas.length === 0) return null;
  const total = jornadas.reduce((s, j) => s + j.esperado, 0);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Jornadas sin rendir ({jornadas.length})
        </span>
        <span className="text-[13px] font-black tabular-nums text-[#B03A2E]">{UYU(total)} en la calle</span>
      </div>
      <p className="text-[11.5px] leading-[1.45] font-medium text-gris">
        Efectivo que quedó sin acta de entrega. Cuando el cobrador te lo dé en mano, registralo
        acá: queda a su nombre y con tu firma.
      </p>
      {jornadas.map((j) => (
        <Fila key={`${j.cobradorId}-${j.fecha}`} j={j} />
      ))}
    </section>
  );
}

function Fila({ j }: { j: JornadaAbierta }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [entregado, setEntregado] = useState(String(j.esperado));
  const [notas, setNotas] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [pend, start] = useTransition();

  const n = Math.max(0, Math.round(Number(entregado) || 0));
  const dif = n - j.esperado;
  const viejo = j.antiguedad >= 3;

  const registrar = () =>
    start(async () => {
      setError(null);
      try {
        const r = await registrarEntregaDiferida({
          cobradorId: j.cobradorId,
          fecha: j.fecha,
          entregado: n,
          notas: notas.trim() || null,
        });
        if (r.ok) {
          setListo(
            r.diferencia === 0
              ? "✓ Registrado · cuadra"
              : `✓ Registrado · ${r.diferencia < 0 ? "falta" : "sobra"} ${UYU(Math.abs(r.diferencia))}`,
          );
          router.refresh();
        } else {
          setError(r.error);
          setConfirmar(false);
        }
      } catch {
        setError("Sin conexión: no se registró. Probá de nuevo.");
        setConfirmar(false);
      }
    });

  if (listo)
    return (
      <div className="rounded-[14px] border border-[#BEEBD5] bg-[#F0FBF5] px-3.5 py-3">
        <span className="text-[13px] font-bold text-[#157A50]">
          {j.cobradorNombre} · {fechaCorta(j.fecha)} — {listo}
        </span>
      </div>
    );

  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] border px-3.5 py-3"
      style={{ borderColor: viejo ? "#F0C0BC" : "#DCE7FB", background: viejo ? "#FDEEEC" : "#F7F9FF" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-bold text-tinta">{j.cobradorNombre}</span>
          <span className="text-[11.5px] font-medium text-gris tabular-nums">
            Jornada del {fechaCorta(j.fecha)} · hace {j.antiguedad} día{j.antiguedad === 1 ? "" : "s"} ·{" "}
            {j.cobros} cobro{j.cobros === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Debería entregar</span>
            <span className="text-[15px] font-black tabular-nums text-tinta">{UYU(j.esperado)}</span>
          </div>
          {!abierto && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="min-h-10 rounded-full bg-[#1FA971] px-3.5 text-[12px] font-extrabold text-white active:scale-95"
            >
              Recibí el efectivo
            </button>
          )}
        </div>
      </div>

      {/* La cuenta DESGLOSADA: sin esto el supervisor no puede discutir el número
          con el cobrador enfrente, y el número es lo único que van a discutir. */}
      <span className="text-[11px] font-medium text-gris tabular-nums">
        {j.base > 0 ? `base ${UYU(j.base)} + ` : ""}cobró {UYU(j.recaudado)}
        {j.gastos > 0 ? ` − gastos ${UYU(j.gastos)}` : ""}
        {j.colocado > 0 ? ` − colocó ${UYU(j.colocado)}` : ""}
      </span>

      {abierto && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-cuerpo">¿Cuánto te dio?</span>
              <div className="flex items-center gap-1 rounded-[12px] border border-borde bg-tarjeta px-2">
                <span className="text-[13px] font-bold text-gris">$</span>
                <input
                  inputMode="numeric"
                  value={entregado}
                  onChange={(e) => {
                    setError(null);
                    setConfirmar(false);
                    setEntregado(e.target.value.replace(/[^\d]/g, ""));
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-28 bg-transparent py-1.5 text-right text-[16px] font-bold tabular-nums outline-none"
                />
              </div>
            </label>
            {/* La diferencia, ANTES de sellar. El acta es inmutable: lo que se ve
                acá es lo que va a quedar escrito para siempre. */}
            <span
              className="rounded-full px-2.5 py-1.5 text-[12px] font-black tabular-nums"
              style={{
                background: dif === 0 ? "#E4F5EC" : dif < 0 ? "#FBE4E2" : "#FDF3E2",
                color: dif === 0 ? "#157A50" : dif < 0 ? "#C0392B" : "#B9770E",
              }}
            >
              {dif === 0 ? "Cuadra ✓" : `${dif < 0 ? "Falta" : "Sobra"} ${UYU(Math.abs(dif))}`}
            </span>
          </div>

          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={200}
            placeholder="Nota (opcional): por qué quedó sin cerrar, motivo del faltante…"
            className="w-full rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul"
          />

          {error && <span className="text-[11.5px] font-bold text-[#C0392B]">{error}</span>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                setConfirmar(false);
                setError(null);
              }}
              className="min-h-10 flex-1 rounded-full border border-borde text-[12px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pend}
              onClick={() => (confirmar ? registrar() : setConfirmar(true))}
              className="min-h-10 flex-1 rounded-full bg-[#1FA971] px-4 text-[12.5px] font-extrabold text-white disabled:opacity-50"
            >
              {pend
                ? "Registrando…"
                : confirmar
                  ? `Sí, recibí ${UYU(n)}`
                  : `Registrar ${UYU(n)}`}
            </button>
          </div>
          <span className="text-[10.5px] leading-[1.4] font-medium text-tenue">
            Queda como acta de {j.cobradorNombre} por la jornada del {fechaCorta(j.fecha)}, registrada
            por vos. No se puede editar después.
          </span>
        </>
      )}
    </div>
  );
}

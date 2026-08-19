"use client";
// Alta de renovación (solo gestor). Muestra los términos del nuevo crédito
// pre-cargados (monto sugerido + días del anterior), calcula la cuota en vivo
// arrastrando la tasa, y confirma en dos pasos porque ESCRIBE DINERO. El
// servidor recalcula la cuota igual (fuente de verdad), así que el preview no
// puede alterar el dinero.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import {
  calcularCuotaRenovacion,
  evaluarRenovacion,
  montoRenovacionPedido,
  montoRenovacionSugerido,
  requiereAprobacionAdmin,
  techoRenovacion,
  RENOVACION_AUMENTO_PCT,
  RENOVACION_CAP_TOTAL,
} from "@/lib/renovacion";
import { interesDeBase } from "@/lib/creditoNuevo";
import { renovarCredito } from "@/app/admin/(panel)/renovaciones/actions";
import type { PrestamoAnterior } from "@/lib/data/renovaciones";
import type { FrecuenciaPrestamo } from "@/types/db";

/** Plazos estándar del negocio (cantidad de cuotas). Cobro diario Lun–Sáb. */
/** Plazos estándar del negocio POR frecuencia: 24 diarios ≈ 4 semanales ≈ 2
 *  quincenales ≈ 1 mensual. Al cambiar de formato se re-sugiere el equivalente
 *  (piloto 19-08: elegir Semanal dejando "24" fabricaba un crédito de 24 SEMANAS
 *  en silencio). */
const PLAZOS_POR_FREC: Record<FrecuenciaPrestamo, readonly number[]> = {
  diario: [20, 24, 30],
  semanal: [4, 6, 8],
  quincenal: [2, 3, 4],
  mensual: [1, 2, 3],
};
/** Cuotas equivalentes al cambiar de frecuencia, manteniendo el PLAZO en días. */
function cuotasEquivalentes(cuotas: number, de: FrecuenciaPrestamo, a: FrecuenciaPrestamo): number {
  const diasPor: Record<FrecuenciaPrestamo, number> = { diario: 1, semanal: 7, quincenal: 15, mensual: 30 };
  if (de === a || !(cuotas > 0)) return cuotas;
  const dias = cuotas * diasPor[de];
  return Math.max(1, Math.round(dias / diasPor[a]));
}

const FRECUENCIAS: { id: FrecuenciaPrestamo; label: string }[] = [
  { id: "diario", label: "Diario" },
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

export function FormRenovacion({
  clienteId,
  clienteNombre,
  anterior,
  moroso = false,
}: {
  clienteId: string;
  clienteNombre: string;
  anterior: PrestamoAnterior;
  /** Cliente marcado como moroso → aviso antes de renovar. */
  moroso?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  // Regla del negocio (Carlos, 06-08): renovar es REPETIR el crédito que la
  // persona terminó, tal cual estaba. Antes esto arrancaba con el monto que
  // INVENTABA el scoring, un número sin relación con el crédito anterior (reporte
  // de campo 08-05, caso 4). Queda editable: subirlo es decisión de quien presta.
  // Para un crédito ya por encima del tope, el "+20% topeado al CAP" daría 100.000
  // — una REBAJA encubierta. En ese caso se arranca del monto que corresponde
  // pedir (sin recorte), que para esos montos es el mismo del crédito anterior.
  const sugerido = requiereAprobacionAdmin(anterior.monto)
    ? montoRenovacionPedido(anterior.monto)
    : montoRenovacionSugerido(anterior.monto);
  const [monto, setMonto] = useState(String(sugerido));
  // Tasa REAL del crédito anterior (la cartera va de 0% a 20%: se muestra, no se
  // asume). Es la que va a arrastrar el crédito nuevo.
  const interesAnterior = interesDeBase({
    monto: anterior.monto,
    cuota: anterior.cuota,
    totalDias: anterior.totalDias,
  });
  // Crédito heredado por encima del tope del sistema: NO se puede renovar acá sin
  // recortarle el capital al cliente (el servidor rechaza cualquier monto > CAP).
  const superaTope = anterior.monto > RENOVACION_CAP_TOTAL;
  const [dias, setDias] = useState(String(anterior.totalDias));
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPrestamo>(anterior.frecuencia);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [via, setVia] = useState<"auto" | "admin" | "solicitud" | null>(null);

  const montoNum = Math.round(Number(monto));
  const diasNum = Math.round(Number(dias));
  const valido =
    Number.isFinite(montoNum) && montoNum > 0 && Number.isInteger(diasNum) && diasNum > 0;

  // Misma función que recalcula el servidor (fuente de verdad del dinero).
  const cuota = valido
    ? calcularCuotaRenovacion(
        { monto: anterior.monto, cuota: anterior.cuota, totalDias: anterior.totalDias },
        montoNum,
        diasNum,
      )
    : 0;
  const totalAPagar = cuota * diasNum;

  // Preview del tope (mismo cálculo que el servidor). Desde el 08-13 TODO GESTOR
  // es aprobador (regla de Carlos: "que den aprobación o hagan esto manual ellos
  // mismos"): el sobre-tope lo autoriza directo también el supervisor, y del
  // panel ya no salen solicitudes — esas quedan para los cobradores en la calle.
  // El techo absoluto (CAP, o el monto del heredado) lo valida el servidor.
  const evalu = valido ? evaluarRenovacion(anterior.monto, montoNum) : null;
  const bloqueado = false;

  const enviar = async () => {
    setOcupado(true);
    setError(null);
    const res = await renovarCredito({
      clienteId,
      prestamoAnteriorId: anterior.id,
      monto: montoNum,
      totalDias: diasNum,
      frecuencia,
    });
    setOcupado(false);
    if (res.ok) {
      setVia(res.via);
      router.refresh();
    } else {
      setConfirmar(false);
      setError(res.error);
    }
  };

  if (via) {
    return (
      <div className="mt-3 rounded-[12px] bg-[#E4F5EC] px-4 py-3 text-[13px] font-bold text-[#157A50]">
        {via === "auto"
          ? "✓ Renovación aprobada al instante (dentro del tope). El nuevo crédito ya está activo."
          : via === "admin"
            ? "✓ Renovación dada de alta. El nuevo crédito ya está activo."
            : "✓ Solicitud enviada. Supera el tope: el administrador la va a aprobar."}
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 w-full rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
        style={{ transition: "transform .1s" }}
      >
        Renovar crédito →
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[14px] border border-borde bg-suave p-3.5">
      <span className="text-[12px] font-bold text-tinta">
        Nuevo crédito para {clienteNombre}
      </span>

      {moroso && (
        <p className="rounded-[12px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-bold text-[#C0392B]">
          ⛔ Cliente marcado como MOROSO. Revisá bien antes de dar de alta.
        </p>
      )}

      {/* El crédito nuevo ARRASTRA la tasa del anterior, y la cartera tiene tasas
          MUY distintas (0%, 3%, 3,5%, 20%…) — es así de verdad, no es un error de
          carga. Por eso la tasa se muestra siempre, en vez de asumir el 20%: quien
          da el alta tiene que ver con qué interés va a nacer el crédito. Subir el
          capital un 20% NO cambia la tasa: el que pagaba 3% sigue en 3%. */}
      <p className="rounded-[12px] bg-tarjeta px-3 py-2 text-[12px] font-medium text-gris">
        Interés del crédito anterior:{" "}
        <b className="text-tinta">{interesAnterior != null ? `${interesAnterior}%` : "—"}</b>{" "}
        ({UYU(anterior.monto)} prestados, {UYU(anterior.cuota * anterior.totalDias)} a devolver).
        El crédito nuevo mantiene esa misma tasa.
      </p>

      {/* Crédito heredado por encima del tope. Renovarlo por el monto sugerido lo
          REDUCIRÍA al tope en silencio (de $1.750.000 a $100.000), así que el
          monto arranca en el del crédito anterior. No se bloquea: lo autoriza el
          admin, y el supervisor lo pide (decisión de Carlos, 06-08). */}
      {/* Techo del GESTOR (regla de Carlos 16-08): hasta +20% sobre el anterior,
          piso en el CAP. Se dice ANTES de tipear — el "no deja" del admin era en
          buena parte no saber hasta dónde podía. */}
      <p className="rounded-[12px] bg-[#EEF3FF] px-3 py-2 text-[12px] font-medium text-[#13308C]">
        Podés autorizar hasta <b className="tabular-nums">{UYU(techoRenovacion(anterior.monto))}</b>{" "}
        (+20% sobre el anterior{anterior.monto < RENOVACION_CAP_TOTAL ? ", o el tope de " + UYU(RENOVACION_CAP_TOTAL) : ""}).
        {superaTope && " Ojo con bajarle el monto: sería recortarle el capital al cliente."}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Capital (UYU)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={monto}
            onChange={(e) => {
              setMonto(e.target.value);
              setConfirmar(false);
            }}
            className="rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] font-semibold outline-none focus:border-azul"
          />
          {/* De dónde sale el número: el crédito se REPITE igual. Si el admin lo
              cambia, se le ofrece volver — así el desvío es siempre deliberado. */}
          {montoNum === sugerido ? (
            <span className="text-[11px] font-medium text-tenue-2">
              Mismo monto que el crédito que terminó
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMonto(String(sugerido));
                setConfirmar(false);
              }}
              className="text-left text-[11px] font-bold text-azul"
            >
              Volver al mismo monto ({UYU(sugerido)})
            </button>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Cantidad de cuotas</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={dias}
            onChange={(e) => {
              setDias(e.target.value);
              setConfirmar(false);
            }}
            className="rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] font-semibold outline-none focus:border-azul"
          />
          {/* Plazos estándar del negocio para la frecuencia elegida. */}
          <div className="mt-1 flex gap-2">
            {PLAZOS_POR_FREC[frecuencia].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setDias(String(p));
                  setConfirmar(false);
                }}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${
                  diasNum === p ? "bg-[#2453DC] text-white" : "bg-tarjeta text-gris border border-borde"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Frecuencia de pago</span>
        <div className="flex flex-wrap gap-1.5">
          {FRECUENCIAS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                // Re-sugerir las cuotas equivalentes (mismo plazo en días):
                // 24 diarias → 4 semanales. El gestor puede cambiarlo después.
                setDias(String(cuotasEquivalentes(diasNum, frecuencia, f.id)));
                setFrecuencia(f.id);
                setConfirmar(false);
              }}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
                frecuencia === f.id ? "bg-[#2453DC] text-white" : "bg-tarjeta text-gris border border-borde"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </label>

      {valido && (
        <div className="flex items-center justify-between rounded-[12px] bg-tarjeta px-3 py-2 text-[12.5px]">
          <span className="font-medium text-gris">
            Cuota <b className="text-tinta">{UYU(cuota)}</b>
          </span>
          <span className="font-medium text-gris">
            Total a pagar <b className="text-tinta">{UYU(totalAPagar)}</b>
          </span>
        </div>
      )}

      {/* Preview del tope escalonado + cap */}
      {evalu && (
        <p
          className={`rounded-[12px] px-3 py-2 text-[12px] font-semibold ${
            evalu.autoAprobable
              ? "bg-[#E4F5EC] text-[#157A50]"
              : bloqueado
                ? "bg-[#FBE4E2] text-[#C0392B]"
                : "bg-[#FDF3E2] text-[#8A6D1E]"
          }`}
        >
          {evalu.autoAprobable
            ? `✓ Dentro del tope (${evalu.topePct}% para créditos de este monto): se aprueba al instante.`
            : `${evalu.motivo} Como gestor, lo autorizás directo.`}
        </p>
      )}

      {error && (
        <p className="rounded-[12px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-semibold text-[#C0392B]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setConfirmar(false);
            setError(null);
          }}
          disabled={ocupado}
          className="rounded-full border border-borde bg-tarjeta px-4 py-2.5 text-[13px] font-bold text-gris disabled:opacity-60"
        >
          Cancelar
        </button>
        {!confirmar ? (
          <button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!valido || ocupado || bloqueado}
            className="flex-1 btn-primario px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {bloqueado ? "No permitido" : "Revisar y dar de alta"}
          </button>
        ) : (
          <button
            type="button"
            onClick={enviar}
            disabled={ocupado}
            className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {ocupado ? "Creando…" : `Confirmar alta · ${UYU(montoNum)}`}
          </button>
        )}
      </div>
      {confirmar && !ocupado && (
        <p className="text-[11px] font-medium text-tenue-2">
          Esto finaliza el crédito actual (saldado) y crea uno nuevo activo.
        </p>
      )}
    </div>
  );
}

"use client";
// Alta de un crédito NUEVO para un cliente que hoy no tiene crédito activo
// (volvió después de terminar el anterior, o es su primero). Confirma en dos
// pasos porque ESCRIBE DINERO. El servidor recalcula la cuota con la MISMA
// función pura, así que este preview no puede alterar el dinero.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularCuotaCreditoNuevo, INTERES_DEFECTO_PCT, interesDeBase } from "@/lib/creditoNuevo";
import { evaluarRenovacion } from "@/lib/renovacion";
import { crearCreditoNuevo } from "@/lib/acciones/creditoNuevo";
import type { FrecuenciaPrestamo } from "@/types/db";

/** Plazos estándar del negocio (cantidad de cuotas). Cobro diario Lun–Sáb. */
const PLAZOS = [20, 24, 30] as const;

const FRECUENCIAS: { id: FrecuenciaPrestamo; label: string }[] = [
  { id: "diario", label: "Diario" },
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

/** Términos del último crédito del cliente (para arrastrar la tasa). */
export interface BaseUltimoCredito {
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: FrecuenciaPrestamo;
  fechaInicio: string;
  estado: string;
}

export function FormCreditoNuevo({
  clienteId,
  clienteNombre,
  base,
  cobradores,
  cobradorSugerido,
  esAdmin = false,
  moroso = false,
  reportado = false,
}: {
  clienteId: string;
  clienteNombre: string;
  /** Último crédito del cliente, o null si nunca tuvo (primer crédito). */
  base: BaseUltimoCredito | null;
  cobradores: { id: string; nombre: string }[];
  cobradorSugerido: string | null;
  esAdmin?: boolean;
  /** Marcado como moroso: aviso antes de volver a prestarle. */
  moroso?: boolean;
  /** Reportado al buró: aviso antes de volver a prestarle. */
  reportado?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [monto, setMonto] = useState(String(base?.monto ?? ""));
  const [dias, setDias] = useState(String(base?.totalDias ?? 24));
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPrestamo>(base?.frecuencia ?? "diario");
  const [interes, setInteres] = useState(String(INTERES_DEFECTO_PCT));
  const [cobradorId, setCobradorId] = useState(cobradorSugerido ?? cobradores[0]?.id ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ cuota: number } | null>(null);

  // Nonce estable por montaje del formulario: si el submit commitea y se pierde
  // la respuesta, el reintento del usuario reusa la MISMA clave → no duplica el
  // crédito. Cambia solo al recargar la ficha (= alta distinta a propósito).
  const nonce = useMemo(() => globalThis.crypto?.randomUUID?.() ?? "", []);

  const montoNum = Math.round(Number(monto));
  const diasNum = Math.round(Number(dias));
  const interesNum = Math.round(Number(interes));
  const valido =
    Number.isFinite(montoNum) && montoNum > 0 &&
    Number.isInteger(diasNum) && diasNum > 0 &&
    cobradorId.length > 0;

  const baseTasa = base ? { monto: base.monto, cuota: base.cuota, totalDias: base.totalDias } : null;
  const conHistorial = !!(baseTasa && baseTasa.monto > 0 && baseTasa.cuota > 0 && baseTasa.totalDias > 0);
  const tasaHistorica = interesDeBase(baseTasa);

  // Misma función que recalcula el servidor (fuente de verdad del dinero).
  const cuota = valido
    ? calcularCuotaCreditoNuevo(baseTasa, montoNum, diasNum, conHistorial ? (tasaHistorica ?? 0) : interesNum)
    : 0;
  const totalAPagar = cuota * diasNum;

  // Preview de los MISMOS topes que aplica el servidor.
  const evalu = valido && conHistorial ? evaluarRenovacion(baseTasa!.monto, montoNum) : null;
  const superaCap = valido ? montoNum > 100_000 : false;
  const sinHistorialYNoAdmin = !conHistorial && !esAdmin;
  const sobreTramoYNoAdmin = !!evalu?.excedePct && !esAdmin;
  const bloqueado = superaCap || sinHistorialYNoAdmin || sobreTramoYNoAdmin;

  const enviar = async () => {
    setOcupado(true);
    setError(null);
    const res = await crearCreditoNuevo({
      clienteId,
      cobradorId,
      monto: montoNum,
      totalDias: diasNum,
      frecuencia,
      interesPct: conHistorial ? undefined : interesNum,
      nonce,
    });
    setOcupado(false);
    if (res.ok) {
      setListo({ cuota: res.cuota });
      router.refresh();
    } else {
      setConfirmar(false);
      setError(res.error);
    }
  };

  if (listo) {
    return (
      <div className="mt-3 rounded-[12px] bg-[#E4F5EC] px-4 py-3 text-[13px] font-bold text-[#157A50]">
        ✓ Crédito dado de alta. Ya está activo y aparece en la ruta del cobrador. Cuota {UYU(listo.cuota)}.
      </div>
    );
  }

  if (cobradores.length === 0) {
    return (
      <p className="mt-3 rounded-[12px] bg-[#FDF3E2] px-3 py-2 text-[12.5px] font-semibold text-[#8A6D1E]">
        Para dar de alta un crédito hace falta al menos un cobrador disponible en la zona.
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 w-full rounded-full bg-[#1FA971] px-4 py-3 text-[13px] font-bold text-white active:scale-[0.99]"
        style={{ transition: "transform .1s" }}
      >
        {conHistorial ? "Dar crédito nuevo →" : "Dar su primer crédito →"}
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[14px] border border-borde bg-suave p-3.5">
      <span className="text-[12px] font-bold text-tinta">Crédito nuevo para {clienteNombre}</span>

      {/* Antecedentes: este cliente ya no está en la cartera, así que el gestor no
          tiene el cartón a la vista para acordarse de cómo pagó la vez pasada. */}
      {(moroso || reportado) && (
        <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-bold text-[#C0392B]">
          {moroso && reportado
            ? "⛔ Cliente marcado como MOROSO y REPORTADO al buró."
            : moroso
              ? "⛔ Cliente marcado como MOROSO."
              : "⛔ Cliente REPORTADO al buró."}{" "}
          Revisá bien antes de volver a prestarle.
        </p>
      )}

      {conHistorial ? (
        <p className="rounded-[10px] bg-[#EAF0FF] px-3 py-2 text-[12px] font-semibold text-[#1E47C8]">
          Su último crédito fue de {UYU(base!.monto)} en {base!.totalDias} cuotas
          {tasaHistorica != null ? ` (interés ${tasaHistorica}%)` : ""}. Se mantienen esas condiciones.
        </p>
      ) : (
        <p className="rounded-[10px] bg-[#FDF3E2] px-3 py-2 text-[12px] font-semibold text-[#8A6D1E]">
          Es el <b>primer crédito</b> de este cliente: no hay historial del que arrastrar la tasa, así
          que el interés se define acá{esAdmin ? "." : " y lo autoriza el administrador."}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Cobrador que lo va a cobrar</span>
        <select
          value={cobradorId}
          onChange={(e) => {
            setCobradorId(e.target.value);
            setConfirmar(false);
          }}
          className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2.5 text-[16px] font-semibold text-tinta outline-none focus:border-azul"
        >
          {cobradores.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </label>

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
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2.5 text-[16px] font-semibold outline-none focus:border-azul"
          />
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
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2.5 text-[16px] font-semibold outline-none focus:border-azul"
          />
          <div className="mt-1 flex gap-2">
            {PLAZOS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setDias(String(p));
                  setConfirmar(false);
                }}
                className={`min-h-[44px] flex-1 rounded-full px-3 text-[13px] font-bold ${
                  diasNum === p ? "bg-[#2453DC] text-white" : "border border-borde bg-tarjeta text-gris"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </label>
      </div>

      {!conHistorial && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Interés total (%)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={interes}
            onChange={(e) => {
              setInteres(e.target.value);
              setConfirmar(false);
            }}
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2.5 text-[16px] font-semibold outline-none focus:border-azul"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Frecuencia de pago</span>
        <div className="flex flex-wrap gap-1.5">
          {FRECUENCIAS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFrecuencia(f.id);
                setConfirmar(false);
              }}
              className={`min-h-[44px] rounded-full px-4 text-[12.5px] font-bold ${
                frecuencia === f.id ? "bg-[#2453DC] text-white" : "border border-borde bg-tarjeta text-gris"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </label>

      {valido && cuota > 0 && (
        <div className="flex items-center justify-between rounded-[10px] bg-tarjeta px-3 py-2 text-[12.5px]">
          <span className="font-medium text-gris">
            Cuota <b className="text-tinta">{UYU(cuota)}</b>
          </span>
          <span className="font-medium text-gris">
            Total a pagar <b className="text-tinta">{UYU(totalAPagar)}</b>
          </span>
        </div>
      )}

      {(superaCap || sobreTramoYNoAdmin || sinHistorialYNoAdmin || evalu?.excedePct) && (
        <p
          className={`rounded-[10px] px-3 py-2 text-[12px] font-semibold ${
            bloqueado ? "bg-[#FBE4E2] text-[#C0392B]" : "bg-[#FDF3E2] text-[#8A6D1E]"
          }`}
        >
          {superaCap
            ? "El crédito no puede superar $100.000 (tope máximo). No se puede dar de alta."
            : sinHistorialYNoAdmin
              ? "El primer crédito de un cliente lo da de alta el administrador."
              : sobreTramoYNoAdmin
                ? `${evalu?.motivo} Pedile al administrador que lo autorice.`
                : `${evalu?.motivo} Como admin, lo autorizás directo.`}
        </p>
      )}

      {error && (
        <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-semibold text-[#C0392B]">{error}</p>
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
          className="min-h-[44px] rounded-full border border-borde bg-tarjeta px-4 text-[13px] font-bold text-gris disabled:opacity-60"
        >
          Cancelar
        </button>
        {!confirmar ? (
          <button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!valido || ocupado || bloqueado || cuota <= 0}
            className="min-h-[44px] flex-1 rounded-full bg-[#2453DC] px-4 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {bloqueado ? "No permitido" : "Revisar y dar de alta"}
          </button>
        ) : (
          <button
            type="button"
            onClick={enviar}
            disabled={ocupado}
            className="min-h-[44px] flex-1 rounded-full bg-[#1FA971] px-4 text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {ocupado ? "Creando…" : `Confirmar alta · ${UYU(montoNum)}`}
          </button>
        )}
      </div>
      {confirmar && !ocupado && (
        <p className="text-[11px] font-medium text-tenue-2">
          Se crea el crédito activo y el cliente entra en la ruta del cobrador elegido desde hoy.
        </p>
      )}
    </div>
  );
}

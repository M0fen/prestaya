"use client";
// Alta de renovación (solo gestor). Muestra los términos del nuevo crédito
// pre-cargados (monto sugerido + días del anterior), calcula la cuota en vivo
// arrastrando la tasa, y confirma en dos pasos porque ESCRIBE DINERO. El
// servidor recalcula la cuota igual (fuente de verdad), así que el preview no
// puede alterar el dinero.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularCuotaRenovacion } from "@/lib/renovacion";
import { renovarCredito, solicitarRenovacion } from "@/app/admin/(panel)/renovaciones/actions";
import type { PrestamoAnterior } from "@/lib/data/renovaciones";
import type { FrecuenciaPrestamo } from "@/types/db";

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
  montoSugerido,
  esAdmin = true,
  moroso = false,
}: {
  clienteId: string;
  clienteNombre: string;
  anterior: PrestamoAnterior;
  montoSugerido: number | null;
  /** Admin: da de alta directo. Supervisor (false): crea una solicitud a aprobar. */
  esAdmin?: boolean;
  /** Cliente marcado como moroso → aviso antes de renovar. */
  moroso?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [monto, setMonto] = useState(String(montoSugerido ?? anterior.monto));
  const [dias, setDias] = useState(String(anterior.totalDias));
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPrestamo>(anterior.frecuencia);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

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

  const enviar = async () => {
    setOcupado(true);
    setError(null);
    const payload = {
      clienteId,
      prestamoAnteriorId: anterior.id,
      monto: montoNum,
      totalDias: diasNum,
      frecuencia,
    };
    const res = esAdmin ? await renovarCredito(payload) : await solicitarRenovacion(payload);
    setOcupado(false);
    if (res.ok) {
      setHecho(true);
      router.refresh();
    } else {
      setConfirmar(false);
      setError(res.error);
    }
  };

  if (hecho) {
    return (
      <div className="mt-3 rounded-[12px] bg-[#E4F5EC] px-4 py-3 text-[13px] font-bold text-[#157A50]">
        {esAdmin
          ? "✓ Renovación dada de alta. El nuevo crédito ya está activo."
          : "✓ Solicitud enviada. El administrador la va a aprobar."}
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
        {esAdmin ? "Renovar crédito →" : "Solicitar renovación →"}
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[14px] border border-[#E6EAF4] bg-[#F7F9FD] p-3.5">
      <span className="text-[12px] font-bold text-tinta">
        Nuevo crédito para {clienteNombre}
      </span>

      {moroso && (
        <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-bold text-[#C0392B]">
          ⛔ Cliente marcado como MOROSO. Revisá bien antes de {esAdmin ? "renovar" : "solicitar"}.
        </p>
      )}

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
            className="rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[14px] font-semibold outline-none focus:border-azul"
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
            className="rounded-[10px] border border-[#DCE3F4] bg-white px-3 py-2 text-[14px] font-semibold outline-none focus:border-azul"
          />
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
                setFrecuencia(f.id);
                setConfirmar(false);
              }}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
                frecuencia === f.id ? "bg-[#2453DC] text-white" : "bg-white text-[#6B7494] border border-[#DCE3F4]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </label>

      {valido && (
        <div className="flex items-center justify-between rounded-[10px] bg-white px-3 py-2 text-[12.5px]">
          <span className="font-medium text-gris">
            Cuota <b className="text-tinta">{UYU(cuota)}</b>
          </span>
          <span className="font-medium text-gris">
            Total a pagar <b className="text-tinta">{UYU(totalAPagar)}</b>
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-semibold text-[#C0392B]">
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
          className="rounded-full border border-[#DCE3F4] bg-white px-4 py-2.5 text-[13px] font-bold text-[#6B7494] disabled:opacity-60"
        >
          Cancelar
        </button>
        {!confirmar ? (
          <button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!valido || ocupado}
            className="flex-1 rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {esAdmin ? "Revisar y dar de alta" : "Revisar y solicitar"}
          </button>
        ) : (
          <button
            type="button"
            onClick={enviar}
            disabled={ocupado}
            className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {ocupado
              ? esAdmin
                ? "Creando…"
                : "Enviando…"
              : `${esAdmin ? "Confirmar alta" : "Enviar solicitud"} · ${UYU(montoNum)}`}
          </button>
        )}
      </div>
      {confirmar && !ocupado && (
        <p className="text-[11px] font-medium text-[#AEB6CC]">
          {esAdmin
            ? "Esto finaliza el crédito actual (saldado) y crea uno nuevo activo."
            : "Queda pendiente hasta que el administrador la apruebe."}
        </p>
      )}
    </div>
  );
}

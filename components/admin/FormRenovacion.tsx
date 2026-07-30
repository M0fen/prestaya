"use client";
// Alta de renovación (solo gestor). Muestra los términos del nuevo crédito
// pre-cargados (monto sugerido + días del anterior), calcula la cuota en vivo
// arrastrando la tasa, y confirma en dos pasos porque ESCRIBE DINERO. El
// servidor recalcula la cuota igual (fuente de verdad), así que el preview no
// puede alterar el dinero.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularCuotaRenovacion, evaluarRenovacion } from "@/lib/renovacion";
import { renovarCredito } from "@/app/admin/(panel)/renovaciones/actions";
import type { PrestamoAnterior } from "@/lib/data/renovaciones";
import type { FrecuenciaPrestamo } from "@/types/db";

/** Plazos estándar del negocio (cantidad de cuotas). Cobro diario Lun–Sáb. */
const PLAZOS = [20, 24, 30] as const;

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

  // Preview del tope (mismo cálculo que el servidor). Dentro del tope del tramo
  // → alta directa. Sobre el tramo: solo el admin autoriza; el resto queda
  // BLOQUEADO. El cap de $100.000 bloquea a TODOS (incluido el admin).
  const evalu = valido ? evaluarRenovacion(anterior.monto, montoNum) : null;
  // Solo el CAP de $100.000 bloquea a todos. El sobre-tope del tramo YA NO bloquea
  // al supervisor: genera una SOLICITUD para el admin (Tanda 6).
  const bloqueado = evalu ? evalu.superaCap : false;
  const esSolicitud = evalu ? evalu.excedePct && !esAdmin : false;

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
        <p className="rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12px] font-bold text-[#C0392B]">
          ⛔ Cliente marcado como MOROSO. Revisá bien antes de dar de alta.
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
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[14px] font-semibold outline-none focus:border-azul"
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
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[14px] font-semibold outline-none focus:border-azul"
          />
          {/* Plazos estándar del negocio (cobro diario Lun–Sáb). */}
          <div className="mt-1 flex gap-1.5">
            {PLAZOS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setDias(String(p));
                  setConfirmar(false);
                }}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
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
        <div className="flex items-center justify-between rounded-[10px] bg-tarjeta px-3 py-2 text-[12.5px]">
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
          className={`rounded-[10px] px-3 py-2 text-[12px] font-semibold ${
            evalu.autoAprobable
              ? "bg-[#E4F5EC] text-[#157A50]"
              : bloqueado
                ? "bg-[#FBE4E2] text-[#C0392B]"
                : "bg-[#FDF3E2] text-[#8A6D1E]"
          }`}
        >
          {evalu.autoAprobable
            ? `✓ Dentro del tope (${evalu.topePct}% para créditos de este monto): se aprueba al instante.`
            : evalu.superaCap
              ? `${evalu.motivo} No se puede dar de alta.`
              : esAdmin
                ? `${evalu.motivo} Como admin, lo autorizás directo.`
                : `${evalu.motivo} Se envía al administrador para que lo apruebe.`}
        </p>
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
          className="rounded-full border border-borde bg-tarjeta px-4 py-2.5 text-[13px] font-bold text-gris disabled:opacity-60"
        >
          Cancelar
        </button>
        {!confirmar ? (
          <button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!valido || ocupado || bloqueado}
            className="flex-1 rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {bloqueado ? "No permitido" : esSolicitud ? "Solicitar aprobación" : "Revisar y dar de alta"}
          </button>
        ) : (
          <button
            type="button"
            onClick={enviar}
            disabled={ocupado}
            className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {ocupado ? (esSolicitud ? "Enviando…" : "Creando…") : esSolicitud ? "Enviar solicitud al admin" : `Confirmar alta · ${UYU(montoNum)}`}
          </button>
        )}
      </div>
      {confirmar && !ocupado && (
        <p className="text-[11px] font-medium text-tenue-2">
          {esSolicitud
            ? "Queda pendiente hasta que el administrador la apruebe (nada se crea todavía)."
            : "Esto finaliza el crédito actual (saldado) y crea uno nuevo activo."}
        </p>
      )}
    </div>
  );
}

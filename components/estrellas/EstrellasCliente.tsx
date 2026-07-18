"use client";
// Estrellas del cliente (reemplaza el "vínculo" emocional de la mascota por algo
// con valor real). Muestra estrellas ganadas, progreso a la próxima (fragmentos)
// y permite SOLICITAR un canje (queda pendiente hasta que el admin lo apruebe).
// Tono amable, números grandes. Deriva de los pagos reales (no truqueable).
import { useState } from "react";
import type { SaldoEstrellas } from "@/lib/estrellas";
import { FRAGMENTOS_POR_ESTRELLA } from "@/lib/estrellas";
import { solicitarRedencion } from "@/app/c/[token]/actions";

export function EstrellasCliente({
  saldo,
  token = null,
}: {
  saldo: SaldoEstrellas;
  token?: string | null;
}) {
  const [cantidad, setCantidad] = useState(1);
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  const puedeCanjear = Boolean(token) && saldo.redimiblesCiclo > 0;
  const max = Math.max(1, saldo.redimiblesCiclo);
  const n = Math.min(cantidad, max);

  const enviar = async () => {
    if (!token) return;
    setEstado("enviando");
    setError("");
    const r = await solicitarRedencion({ token, cantidad: n });
    if (r.ok) setEstado("ok");
    else {
      setError(r.error);
      setEstado("error");
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-[#F0E2A8] bg-[linear-gradient(180deg,#FFFDF5,#FFF8E6)] p-4">
      <div className="flex items-center gap-3">
        <span className="text-[30px]" aria-hidden="true">⭐</span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[16px] font-extrabold text-[#8A6D1E]">Tus estrellas</span>
          <span className="text-[12.5px] font-medium text-[#A98B3E]">
            Cada pago suma. ¡5 pagos = 1 estrella!
          </span>
        </div>
        <span className="ml-auto text-[28px] font-black text-[#C79A1E] tabular-nums">
          {saldo.disponibles}
        </span>
      </div>

      {/* Progreso a la próxima estrella (fragmentos) */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11.5px] font-semibold text-[#A98B3E]">
          <span>Próxima estrella</span>
          <span className="tabular-nums">
            {saldo.progresoFragmento}/{FRAGMENTOS_POR_ESTRELLA}
          </span>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: FRAGMENTOS_POR_ESTRELLA }).map((_, i) => (
            <span
              key={i}
              className="h-2.5 flex-1 rounded-full"
              style={{ background: i < saldo.progresoFragmento ? "#E8A317" : "#F0E6C8" }}
            />
          ))}
        </div>
      </div>

      {saldo.estrellasPendientes > 0 && (
        <p className="rounded-[10px] bg-[#FFF3D6] px-3 py-2 text-[12px] font-medium text-[#8A6D1E]">
          Tenés una solicitud de canje pendiente de aprobación. ¡Ya casi!
        </p>
      )}

      {/* Canje */}
      {estado === "ok" ? (
        <p className="rounded-[10px] bg-[#E7F7EF] px-3 py-2.5 text-[13px] font-bold text-[#157A50]">
          ✓ ¡Listo! Pedimos tu canje de {n} estrella{n > 1 ? "s" : ""}. La oficina lo revisa y te avisa.
        </p>
      ) : puedeCanjear ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-[#F0E2A8] bg-white px-2 py-1">
            <button
              type="button"
              aria-label="Menos"
              onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[18px] font-bold text-[#C79A1E] disabled:opacity-40"
              disabled={n <= 1}
            >
              −
            </button>
            <span className="w-6 text-center text-[16px] font-extrabold text-[#8A6D1E] tabular-nums">{n}</span>
            <button
              type="button"
              aria-label="Más"
              onClick={() => setCantidad((c) => Math.min(max, c + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[18px] font-bold text-[#C79A1E] disabled:opacity-40"
              disabled={n >= max}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={enviar}
            disabled={estado === "enviando"}
            className="flex-1 rounded-full bg-[linear-gradient(90deg,#E8A317,#C79A1E)] px-4 py-2.5 text-[14px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {estado === "enviando" ? "Enviando…" : `Canjear ${n} estrella${n > 1 ? "s" : ""}`}
          </button>
        </div>
      ) : (
        <p className="text-[12px] font-medium text-[#A98B3E]">
          {saldo.disponibles > 0
            ? "Este mes ya pediste tu canje. ¡El mes que viene va de nuevo!"
            : "Seguí pagando para ganar tu próxima estrella. 🌟"}
        </p>
      )}

      {estado === "error" && (
        <p className="text-[12px] font-semibold text-[#E06A6A]">{error}</p>
      )}
    </section>
  );
}

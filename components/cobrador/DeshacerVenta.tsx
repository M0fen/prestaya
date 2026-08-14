"use client";
// ─────────────────────────────────────────────────────────────────────────
//  DESHACER una venta recién colocada (pedido de Carlos, 08-14). Vive en dos
//  lugares: el cartel de confirmación de ColocarLista (donde el dedazo se nota
//  al segundo) y las "Ventas del día" de Informes (donde se repasa la jornada).
//
//  El botón decide si mostrarse con la MISMA función pura que valida el
//  servidor (`puedeDeshacerVenta`) — la pantalla nunca ofrece lo que el server
//  va a rechazar. Dos toques porque DESHACE un crédito, y cuenta regresiva
//  visible: pasada la hora, la salida es la oficina y el botón lo dice.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deshacerVentaDesdeCalle } from "@/lib/acciones/cobradorCredito";
import { DESHACER_VENTA_MS } from "@/lib/creditoNuevo";
import { UYU } from "@/lib/format";

export function DeshacerVenta({
  prestamoId,
  monto,
  creadoEn,
  /** true = renovación: no se ofrece (reabriría el anterior; lo hace la oficina). */
  esRenovacion = false,
}: {
  prestamoId: string;
  monto: number;
  /** ISO de creado_en del crédito. */
  creadoEn: string;
  esRenovacion?: boolean;
}) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState(false);
  const [hecho, setHecho] = useState<null | "deshecha" | "yaEstaba">(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  // Tic por minuto para la cuenta regresiva (no hace falta más resolución).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // La confirmación armada se desarma sola (mismo criterio que cobrar: un tap
  // distraído minutos después no puede deshacer un crédito sin aviso fresco).
  useEffect(() => {
    if (!confirmar) return;
    const t = setTimeout(() => setConfirmar(false), 8000);
    return () => clearTimeout(t);
  }, [confirmar]);

  if (esRenovacion) return null;
  const quedanMs = DESHACER_VENTA_MS - (ahora - new Date(creadoEn).getTime());
  if (hecho) {
    return (
      <span className="rounded-[12px] bg-ambar-suave px-3 py-2 text-[12px] leading-[1.45] font-bold text-ambar-osc">
        {hecho === "yaEstaba" ? "Ya estaba deshecha ✓" : "Venta deshecha ✓"} — el crédito quedó
        cancelado y la plata vuelve a tu caja. Si ya le habías entregado el efectivo, recuperalo.
      </span>
    );
  }
  if (!(quedanMs > 0)) return null;
  const min = Math.max(1, Math.round(quedanMs / 60_000));

  const deshacer = () =>
    start(async () => {
      setError(null);
      try {
        const r = await deshacerVentaDesdeCalle({ prestamoId });
        if (r.ok) {
          setHecho(r.yaEstaba ? "yaEstaba" : "deshecha");
          router.refresh();
        } else {
          setError(r.error);
          setConfirmar(false);
        }
      } catch {
        // Sin señal: reintentar es seguro (si ya se deshizo, contesta "ya estaba").
        setError("Sin señal: no sabemos si entró. Con conexión, tocá de nuevo — no pasa nada por repetir.");
        setConfirmar(false);
      }
    });

  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pendiente}
        onClick={() => (confirmar ? deshacer() : setConfirmar(true))}
        className={`min-h-10 self-start rounded-full px-3.5 text-[12px] font-bold tabular-nums active:scale-95 disabled:opacity-50 ${
          confirmar
            ? "bg-rojo-suave text-rojo-osc"
            : "border border-campo bg-tarjeta text-gris"
        }`}
      >
        {pendiente
          ? "Deshaciendo…"
          : confirmar
            ? `Sí, deshacer la venta de ${UYU(monto)}`
            : `↩ Deshacer · ${min} min`}
      </button>
      {error && <span className="text-[11.5px] leading-[1.4] font-semibold text-rojo-osc">{error}</span>}
    </span>
  );
}

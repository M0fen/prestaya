"use client";
// Cartón del cobrador con REFLEJO OPTIMISTA. El cartón "real" lo calcula el
// servidor (calcularEstadosCarton) y se pasa acá ya resuelto; este componente
// solo le suma, EN VIVO, lo que el cobrador acaba de registrar y todavía está en
// la cola offline (aún no sincronizó). Así, apenas cobra, el día de HOY se marca
// como pagado/abono con un sello — sin esperar el round-trip al servidor.
//
// Money-safe: NO recalcula saldos ni suma montos autoritativos; solo cambia el
// ESTADO VISUAL del día de hoy (pagado/pendiente), que es idempotente frente al
// dato del servidor. Una "gracia" mantiene el sello unos segundos tras sincronizar
// para que el refresco del server tome la posta sin parpadeo.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { DiaEstado, EstadoDia } from "@/types/cartones";
import {
  pendientes,
  suscribir,
  suscribirConfirmado,
  type OpCobro,
} from "@/lib/cobrador/colaOffline";

// Rojo FUERTE (#D64545) para el atrasado: el cobrador tiene que cobrarlo, así que
// el día vencido le grita (el rojo suave #E06A6A es el "amable" de la vista del
// cliente, no el de la calle). El resto sigue la paleta de estados del skill.
const COLOR: Record<EstadoDia, string> = {
  pagado: "#1FA971",
  pendiente: "#E8A317",
  atrasado: "#D64545",
  futuro: "#EEF1F8",
};

// Cuánto tiempo se mantiene el sello tras confirmar el sync (cubre el refresco
// del servidor para que el día no vuelva a "pendiente" un instante).
const GRACIA_MS = 7000;

const montoDe = (o: OpCobro, cuota: number): number =>
  o.monto != null && o.monto > 0 ? o.monto : cuota;

// Monto del abono en formato COMPACTO para la casilla del cartón (poco espacio):
// 500 → "500", 1.500 → "1.5k", 20.000 → "20k". El detalle exacto vive en la ficha.
const montoCompacto = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n)}`;

export function CartonCobrador({
  dias,
  cuota,
  progresoPct,
  clienteId,
  prestamoId,
}: {
  dias: DiaEstado[];
  cuota: number;
  progresoPct: number;
  clienteId: string;
  prestamoId: string;
}) {
  const cola = useSyncExternalStore(suscribir, pendientes, () => [] as OpCobro[]);
  // Ops recién confirmadas (sync OK): se mantienen unos segundos de gracia.
  const [enGracia, setEnGracia] = useState<OpCobro[]>([]);

  const coincide = (o: OpCobro): boolean =>
    o.tipo === "pago" &&
    o.clienteId === clienteId &&
    (o.prestamoId == null || o.prestamoId === prestamoId);

  useEffect(() => {
    return suscribirConfirmado((op) => {
      if (!(op.tipo === "pago" && op.clienteId === clienteId)) return;
      setEnGracia((prev) => [...prev, op]);
      setTimeout(() => setEnGracia((prev) => prev.filter((o) => o.id !== op.id)), GRACIA_MS);
    });
  }, [clienteId]);

  const enCola = cola.filter(coincide);
  const hayEnCola = enCola.length > 0;
  // Monto encolado (pendiente de sync) + en gracia (recién confirmado): decide el
  // estado visual del día de hoy, sin sumar a ningún total autoritativo.
  const montoOptimista = [...enCola, ...enGracia.filter(coincide)].reduce(
    (s, o) => s + montoDe(o, cuota),
    0,
  );
  const idxHoy = dias.findIndex((d) => d.esHoy);

  return (
    <div className="rounded-[16px] bg-[#F1E8D2] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11.5px] font-bold text-[#8A6D1E]">Cartón</span>
        <span className="text-[11px] font-medium text-[#a98b3e]">{progresoPct}% pagado</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {dias.map((d, i) => {
          let estado: EstadoDia = d.estado;
          let provisional = false;
          // Overlay SOLO del día de hoy y solo si aún no figura pagado en el server.
          if (i === idxHoy && montoOptimista > 0 && d.estado !== "pagado") {
            const totalHoy = d.montoPagado + montoOptimista;
            estado = totalHoy >= cuota ? "pagado" : "pendiente";
            provisional = true;
          }
          return (
            <div
              key={d.dia}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-[14px] text-[11px] leading-none font-bold ${
                provisional ? "py-sello" : ""
              }`}
              style={{
                background: COLOR[estado],
                color: estado === "futuro" ? "#B3A488" : "#fff",
                // HOY: doble anillo (blanco + color del estado), como en la vista del cliente/admin.
                boxShadow: d.esHoy ? `0 0 0 3px #fff, 0 0 0 6px ${COLOR[estado]}` : "none",
              }}
            >
              <span>{estado === "pagado" ? "✓" : d.dia}</span>
              {/* Monto del abono del día (cuánto se pagó), visible de un vistazo. */}
              {d.montoPagado > 0 && (
                <span className="mt-[1px] text-[7.5px] font-black tracking-tight tabular-nums opacity-95">
                  {montoCompacto(d.montoPagado)}
                </span>
              )}
              {provisional && (
                <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#13308C] text-[8px] font-black text-white">
                  ⟳
                </span>
              )}
            </div>
          );
        })}
      </div>
      {hayEnCola && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#8A6D1E]">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#1FA971]" />
          Tu cobro de hoy quedó registrado · se sincroniza solo.
        </p>
      )}
    </div>
  );
}

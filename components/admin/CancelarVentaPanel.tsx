"use client";
// ─────────────────────────────────────────────────────────────────────────
//  "Cancelar esta venta" en la ficha del cliente (panel) — queja del admin 16-08.
//  Dos toques + motivo obligatorio. La regla es la del servidor (la pantalla
//  pide `estadoCancelable` y muestra la MISMA verdad: si hay pagos, dice cuántos
//  y qué hacer; si es renovación, avisa que reabre el anterior).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarVentaPanel, estadoCancelable } from "@/lib/acciones/cancelarVenta";
import { UYU } from "@/lib/format";

export function CancelarVentaPanel({ prestamoId, monto }: { prestamoId: string; monto: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof estadoCancelable>> | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pend, start] = useTransition();

  useEffect(() => {
    if (!abierto || info) return;
    let vivo = true;
    estadoCancelable(prestamoId).then((r) => { if (vivo) setInfo(r); });
    return () => { vivo = false; };
  }, [abierto, info, prestamoId]);

  if (msg?.ok) {
    return (
      <div className="mt-2 rounded-[12px] bg-[#FDF3E2] px-3.5 py-2.5 text-[12.5px] font-bold text-[#8A6D1E]">
        {msg.texto}
      </div>
    );
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="mt-2 w-fit rounded-full border border-[#F0C9C4] bg-[#FBE4E2] px-3.5 py-1.5 text-[12px] font-bold text-[#C0392B] active:scale-95">
        Cancelar esta venta…
      </button>
    );
  }

  const puede = info?.ok ? info.puede : false;
  const cancelar = () =>
    start(async () => {
      const r = await cancelarVentaPanel({ prestamoId, motivo });
      if (r.ok) {
        setMsg({ ok: true, texto: r.yaEstaba ? "Esta venta ya estaba cancelada." : `✓ Venta de ${UYU(monto)} cancelada.${r.avisos.length ? " " + r.avisos.join(" ") : ""}` });
        router.refresh();
      } else {
        setMsg({ ok: false, texto: r.error });
        setConfirmar(false);
      }
    });

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[14px] border border-[#F0C9C4] bg-[#FFF7F6] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-extrabold text-[#C0392B]">Cancelar la venta de {UYU(monto)}</span>
        <button type="button" onClick={() => { setAbierto(false); setConfirmar(false); setMsg(null); }} className="text-[12px] font-bold text-gris">Cerrar</button>
      </div>
      {!info ? (
        <span className="text-[12px] font-medium text-gris">Revisando el crédito…</span>
      ) : !info.ok ? (
        <span className="text-[12px] font-bold text-[#C0392B]">{info.error}</span>
      ) : !info.puede ? (
        <span className="rounded-[10px] bg-tarjeta px-3 py-2 text-[12px] font-semibold text-cuerpo">{info.motivo}</span>
      ) : (
        <>
          <p className="text-[12px] leading-[1.5] font-medium text-cuerpo">
            El crédito queda <b>cancelado</b> (no se borra: queda el rastro). No cuenta como colocado ni en la caja del cobrador.
            {info.esRenovacion && <> <b>Es una renovación:</b> se reabre el crédito anterior tal como estaba.</>}
            {info.origen === "tienda" && <> <b>Es una venta de tienda:</b> se devuelve el stock y se cierra el pedido.</>}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-gris">Motivo (queda en la auditoría)</span>
            <input value={motivo} onChange={(e) => { setMotivo(e.target.value); setConfirmar(false); }} maxLength={300}
              placeholder="Ej.: dedazo, era para otro cliente, el cliente se arrepintió…"
              className="rounded-[10px] border border-campo bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul" />
          </label>
          {!confirmar ? (
            <button type="button" disabled={motivo.trim().length < 5} onClick={() => setConfirmar(true)}
              className="w-fit rounded-full bg-[#C0392B] px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-40 active:scale-95">
              Cancelar la venta
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-bold text-[#C0392B]">¿Seguro? Esto no se deshace.</span>
              <button type="button" disabled={pend} onClick={cancelar}
                className="rounded-full bg-[#C0392B] px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60 active:scale-95">
                {pend ? "Cancelando…" : "Sí, cancelar"}
              </button>
              <button type="button" onClick={() => setConfirmar(false)} className="text-[12px] font-bold text-gris">No</button>
            </div>
          )}
        </>
      )}
      {msg && !msg.ok && <span className="text-[12px] font-bold text-[#C0392B]">{msg.texto}</span>}
    </div>
  );
}

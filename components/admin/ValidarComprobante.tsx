"use client";
// Validar un COMPROBANTE de premio (raspadita) por su folio: la oficina pone el
// número que trae el cliente, ve el premio/cliente/fecha y lo marca CANJEADO
// (usado) para que no se reutilice. Cierra el ciclo premio → folio → validación.
import { useState, useTransition } from "react";
import { validarComprobanteAction, canjearComprobanteAction } from "@/lib/acciones/promos";
import type { ComprobanteRaspa } from "@/lib/data/promos";

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export function ValidarComprobante() {
  const [folio, setFolio] = useState("");
  const [comp, setComp] = useState<ComprobanteRaspa | null>(null);
  const [buscado, setBuscado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();

  const folioN = Math.round(Number(folio) || 0);

  const buscar = () => {
    setErr(null); setMsg(null); setComp(null); setBuscado(false);
    start(async () => {
      const r = await validarComprobanteAction(folioN);
      if (!r.ok) { setErr(r.error); return; }
      setComp(r.comprobante);
      setBuscado(true);
    });
  };

  const canjear = () => {
    setErr(null); setMsg(null);
    start(async () => {
      const r = await canjearComprobanteAction(folioN);
      if (!r.ok) { setErr(r.error); return; }
      if (r.estado === "canjeado") { setMsg("✓ Comprobante canjeado. Quedó marcado como usado."); }
      else if (r.estado === "ya-estaba") { setMsg("Este comprobante ya estaba canjeado."); }
      else { setErr("No existe un comprobante con ese folio."); }
      // Refrescar el detalle para reflejar el canje.
      const v = await validarComprobanteAction(folioN);
      if (v.ok) setComp(v.comprobante);
    });
  };

  const esBeneficio = comp?.premioTipo === "beneficio";
  const yaCanjeado = !!comp?.canjeadoEn;

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-extrabold text-tinta">Validar un comprobante</span>
        <span className="text-[12px] font-medium text-gris">
          Poné el N.º de comprobante que trae el cliente. Verificás el premio y lo marcás usado.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={folio}
          onChange={(e) => setFolio(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="N.º de comprobante (ej. 123)"
          className="min-w-0 flex-1 rounded-[12px] border border-campo px-3 py-2.5 text-[15px] tabular-nums outline-none focus:border-azul"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={pend || !(folioN > 0)}
          className="flex-shrink-0 rounded-full bg-azul px-4 py-2.5 text-[13px] font-extrabold text-white active:scale-[0.98] disabled:opacity-40"
        >
          {pend ? "…" : "Buscar"}
        </button>
      </div>

      {buscado && !comp && (
        <p className="rounded-[12px] bg-ambar-suave px-3.5 py-2.5 text-[12.5px] font-semibold text-ambar-osc">
          No existe ningún comprobante con el folio {String(folioN).padStart(6, "0")}. Revisá el número.
        </p>
      )}

      {comp && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-borde bg-suave p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-azul-suave px-2.5 py-0.5 text-[12px] font-black tabular-nums text-azul">
              N.º {String(comp.folio).padStart(6, "0")}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                yaCanjeado ? "bg-rojo-suave text-rojo-osc" : "bg-verde-suave text-verde-osc"
              }`}
            >
              {yaCanjeado ? "Ya usado" : "Válido"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <Fila k="Cliente" v={comp.clienteNombre} />
            <Fila k="Premio" v={`${esBeneficio ? "🎉 " : "🍀 "}${comp.premioLabel}`} />
            <Fila k="Jugado" v={fechaHora(comp.jugadoEn)} />
            <Fila k="Canjeado" v={comp.canjeadoEn ? `${fechaHora(comp.canjeadoEn)}${comp.canjeadoPorNombre ? ` · ${comp.canjeadoPorNombre}` : ""}` : "—"} />
          </div>

          {!esBeneficio ? (
            <p className="text-[12px] font-medium text-gris">Este comprobante no es un premio (fue “seguí participando”).</p>
          ) : yaCanjeado ? (
            <p className="text-[12px] font-semibold text-rojo-osc">Este premio ya fue entregado. No se puede volver a usar.</p>
          ) : (
            <button
              type="button"
              onClick={canjear}
              disabled={pend}
              className="mt-1 w-full rounded-[12px] bg-[#1FA971] py-2.5 text-[13px] font-extrabold text-white active:scale-[0.99] disabled:opacity-60"
            >
              {pend ? "…" : "Marcar como entregado ✓"}
            </button>
          )}
        </div>
      )}

      {msg && <span className="text-[12px] font-bold text-verde">{msg}</span>}
      {err && <span className="text-[12px] font-semibold text-[#C0392B]">{err}</span>}
    </section>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col rounded-[12px] bg-tarjeta px-2.5 py-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tenue">{k}</span>
      <span className="truncate text-[12.5px] font-bold text-tinta">{v}</span>
    </div>
  );
}

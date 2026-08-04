"use client";
// ─────────────────────────────────────────────────────────────────────────
//  RENOVAR (1 toque, términos idénticos) y NUEVA VENTA (monto a elección).
//
//  En la calle, frente al cliente: buscador arriba, tarjeta con los números
//  grandes, y una confirmación de dos toques antes de colocar el capital
//  (misma protección que el cobro: nada de plata sale de un solo tap).
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { renovarDesdeCalle, nuevaVentaDesdeCalle } from "@/lib/acciones/cobradorCredito";
import type { FrecuenciaPrestamo } from "@/types/db";

interface Candidato {
  clienteId: string;
  nombre: string;
  documento: string | null;
  prestamoId?: string;
  monto: number;
  cuota: number;
  totalDias: number;
  frecuencia: string;
  /** Hasta cuánto puede llegar sin permiso (tope del tramo de SU monto anterior).
   *  Lo calcula el servidor con la misma función que después valida el alta. */
  techo: number;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function ColocarLista({
  modo,
  candidatos,
}: {
  modo: "renovar" | "venta";
  candidatos: Candidato[];
}) {
  const [q, setQ] = useState("");
  const filtrados = useMemo(() => {
    const t = norm(q);
    if (!t) return candidatos;
    const dig = q.replace(/\D/g, "");
    return candidatos.filter(
      (c) =>
        norm(c.nombre).includes(t) ||
        (dig.length >= 3 && (c.documento ?? "").replace(/\D/g, "").includes(dig)),
    );
  }, [q, candidatos]);

  if (candidatos.length === 0) {
    return (
      <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] leading-[1.5] font-medium text-gris">
        {modo === "renovar"
          ? "Ninguno de tus clientes terminó de pagar todavía. Cuando alguno complete su crédito, aparece acá para renovarlo de un toque."
          : "No tenés clientes libres para una venta nueva. Aparecen los que ya no tienen crédito activo y alguna vez tuvieron uno."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Buscar por nombre o cédula…"
        className="w-full rounded-[13px] border border-borde bg-white px-3.5 py-3 text-[16px] outline-none focus:border-azul"
      />
      {filtrados.length === 0 ? (
        <p className="py-3 text-center text-[12.5px] font-medium text-gris">
          Ninguno coincide con “{q}”.
        </p>
      ) : (
        filtrados.map((c) => (
          <Tarjeta key={c.clienteId + (c.prestamoId ?? "")} c={c} modo={modo} />
        ))
      )}
    </div>
  );
}

function Tarjeta({ c, modo }: { c: Candidato; modo: "renovar" | "venta" }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [monto, setMonto] = useState(String(c.monto));
  const [cuotas, setCuotas] = useState(String(c.totalDias));
  const [msg, setMsg] = useState<string | null>(null);
  const [okTxt, setOkTxt] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  const montoN = Math.round(Number(monto) || 0);
  const cuotasN = Math.round(Number(cuotas) || 0);
  const techo = c.techo;
  const excede = montoN > techo;

  const colocar = () =>
    start(async () => {
      setMsg(null);
      const r =
        modo === "renovar"
          ? await renovarDesdeCalle({ clienteId: c.clienteId, prestamoId: c.prestamoId! })
          : await nuevaVentaDesdeCalle({
              clienteId: c.clienteId,
              monto: montoN,
              totalDias: cuotasN,
              frecuencia: c.frecuencia as FrecuenciaPrestamo,
            });
      if (r.ok) {
        setOkTxt(r.cuota ? `Listo ✓ · cuota ${UYU(r.cuota)}` : "Listo ✓");
        router.refresh();
      } else {
        setMsg(r.error);
        setConfirmar(false);
      }
    });

  if (okTxt) {
    return (
      <div className="rounded-[16px] border border-[#BEEBD5] bg-[#F0FBF5] p-4">
        <span className="text-[14px] font-extrabold text-[#157A50]">{c.nombre}</span>
        <p className="mt-0.5 text-[12.5px] font-bold text-[#157A50]">{okTxt}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-tinta">{c.nombre}</span>
          <span className="text-[11.5px] font-semibold text-gris tabular-nums">
            {modo === "renovar" ? "Terminó de pagar ✓" : "Sin crédito activo"}
            {c.documento ? ` · ${c.documento}` : ""}
          </span>
        </div>
        {!abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="min-h-11 flex-shrink-0 rounded-full bg-[#1E47C8] px-4 text-[13px] font-extrabold text-white active:scale-95"
          >
            {modo === "renovar" ? "Renovar" : "Vender"}
          </button>
        )}
      </div>

      {abierto && (
        <>
          {modo === "renovar" ? (
            // Términos IDÉNTICOS: no hay nada que tipear, solo confirmar.
            <div className="grid grid-cols-3 gap-2 rounded-[13px] bg-[#F7F9FD] p-3">
              <Dato k="Monto" v={UYU(c.monto)} />
              <Dato k="Cuota" v={UYU(c.cuota)} />
              <Dato k="Cuotas" v={String(c.totalDias)} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[10.5px] font-bold text-gris">Monto</span>
                  <input
                    inputMode="numeric"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))}
                    className="min-h-11 rounded-[11px] border border-borde px-3 text-[16px] font-bold tabular-nums text-tinta"
                  />
                </label>
                <label className="flex w-24 flex-col gap-0.5">
                  <span className="text-[10.5px] font-bold text-gris">Cuotas</span>
                  <input
                    inputMode="numeric"
                    value={cuotas}
                    onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ""))}
                    className="min-h-11 rounded-[11px] border border-borde px-3 text-[16px] font-bold tabular-nums text-tinta"
                  />
                </label>
              </div>
              <span
                className={`text-[11.5px] leading-[1.4] font-semibold ${
                  excede ? "text-[#C0392B]" : "text-gris"
                }`}
              >
                {excede
                  ? `Sin permiso podés llegar hasta ${UYU(techo)}. Para más, pedíselo a tu supervisor.`
                  : `Su último crédito fue de ${UYU(c.monto)} · podés llegar hasta ${UYU(techo)}.`}
              </span>
            </div>
          )}

          {msg && <span className="text-[11.5px] font-semibold text-[#C0392B]">{msg}</span>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                setConfirmar(false);
                setMsg(null);
              }}
              className="min-h-11 flex-1 rounded-[13px] border border-borde text-[13px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pendiente || excede || (modo === "venta" && (montoN <= 0 || cuotasN <= 0))}
              onClick={() => (confirmar ? colocar() : setConfirmar(true))}
              className="min-h-11 flex-1 rounded-[13px] bg-[#1FA971] text-[13px] font-extrabold text-white disabled:opacity-50"
            >
              {pendiente
                ? "Creando…"
                : confirmar
                  ? modo === "renovar"
                    ? `Sí, renovar ${UYU(c.monto)}`
                    : `Sí, dar ${UYU(montoN)}`
                  : "Confirmar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] font-bold text-gris">{k}</span>
      <span className="text-[15px] font-extrabold tabular-nums text-tinta">{v}</span>
    </div>
  );
}

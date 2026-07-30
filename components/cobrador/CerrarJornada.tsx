"use client";
// Cierre de jornada del cobrador (rendición). Muestra lo RECAUDADO (del
// servidor), pide gastos de ruta + efectivo entregado, calcula en vivo la
// diferencia (cuadra / faltante / sobrante) y cierra por Server Action. Una vez
// cerrada, muestra el resumen. Mobile-first.
import { useState, useEffect, useTransition, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { calcularRendicion, ETIQUETA_ESTADO, type EstadoRendicion } from "@/lib/rendicion";
import { cerrarJornada } from "@/lib/acciones/rendicion";
import { suscribir, pendientes, hidratar, quitar, opAtascada } from "@/lib/cobrador/colaOffline";
import type { RendicionDia } from "@/lib/data/rendicion";

const TONO: Record<EstadoRendicion, { bg: string; fg: string }> = {
  cuadra: { bg: "#E4F5EC", fg: "#157A50" },
  faltante: { bg: "#FBE4E2", fg: "#C0392B" },
  sobrante: { bg: "#FDF3E2", fg: "#B9770E" },
};

export function CerrarJornada({
  recaudado,
  cobrosCantidad,
  gastosHoy = 0,
  gastosPendientes = 0,
  base = 0,
  yaRendida,
  disponible,
}: {
  recaudado: number;
  cobrosCantidad: number;
  gastosHoy?: number;
  /** Gastos SOLICITADOS pero aún no aprobados: si el cobrador ya sacó esa plata,
   *  le saldría un faltante. Se AVISA (no se resta solo del prefijado). */
  gastosPendientes?: number;
  /** Base de arranque que recibió del supervisor (0105): la devuelve junto con lo
   *  cobrado → esperado = base + recaudado − gastos. 0 si no tiene. */
  base?: number;
  yaRendida: RendicionDia | null;
  disponible: boolean;
}) {
  const router = useRouter();
  // Prellena los gastos con lo que el cobrador ya cargó hoy (puede ajustarlo).
  const [gastos, setGastos] = useState(gastosHoy > 0 ? String(gastosHoy) : "");
  // Prellena el efectivo a entregar = base + recaudado − gastos (devuelve la base).
  const [entregado, setEntregado] = useState(String(Math.max(0, base + recaudado - gastosHoy)));
  // ¿El cobrador tocó los campos a mano? Si NO, el prefijado se re-sincroniza cuando
  // sube el `recaudado` del servidor (al drenar la cola, `router.refresh` sube el
  // prop SIN desmontar este componente). Sin esto, `entregado` quedaba en el valor
  // viejo y el cierre marcaba un FALTANTE FANTASMA justo al terminar de sincronizar.
  const [editado, setEditado] = useState(false);
  const [notas, setNotas] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  // Cola offline (solo LECTURA): cobros registrados sin señal que AÚN no llegaron
  // al servidor. El `recaudado` de arriba es del servidor y NO los incluye → si el
  // cobrador cierra con cobros en la cola, rinde con un FALTANTE FANTASMA (plata
  // que sí cobró pero no subió). Anti-fuga: se avisa y se bloquea el cierre.
  const ops = useSyncExternalStore(suscribir, pendientes, () => []);
  useEffect(() => {
    hidratar();
  }, []);
  // Re-sincroniza el prefijado con el recaudado autoritativo del servidor mientras
  // el cobrador no haya editado los campos (evita el faltante fantasma al cerrar).
  useEffect(() => {
    if (editado) return;
    setGastos(gastosHoy > 0 ? String(gastosHoy) : "");
    setEntregado(String(Math.max(0, base + recaudado - gastosHoy)));
  }, [recaudado, gastosHoy, editado, base]);

  if (!disponible) return null; // se habilita al correr 0013

  // Ya cerró: resumen de solo lectura.
  if (yaRendida) {
    const t = TONO[yaRendida.estado];
    return (
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-extrabold text-tinta">
            {yaRendida.estado === "cuadra" ? "¡Bien ahí! Jornada cerrada 🎉" : "Jornada cerrada ✓"}
          </span>
          <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {ETIQUETA_ESTADO[yaRendida.estado]}
          </span>
        </div>
        {yaRendida.estado === "cuadra" && (
          <p className="mb-2 text-[12.5px] font-medium text-[#4E9E79]">
            Cuadraste perfecto. Gracias por tu laburo de hoy 💚
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          {yaRendida.base > 0 && <Fila k="Base recibida" v={UYU(yaRendida.base)} />}
          <Fila k="Recaudado" v={UYU(yaRendida.recaudado)} />
          <Fila k="Gastos de ruta" v={UYU(yaRendida.gastos)} />
          <Fila k="A entregar" v={UYU(Math.max(0, yaRendida.base + yaRendida.recaudado - yaRendida.gastos))} />
          <Fila k="Entregado" v={UYU(yaRendida.entregado)} />
        </div>
        {yaRendida.diferencia !== 0 && (
          <div className="mt-2 rounded-[10px] px-3 py-2 text-[12.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {yaRendida.diferencia < 0 ? "Faltante" : "Sobrante"} de {UYU(Math.abs(yaRendida.diferencia))}
          </div>
        )}
      </section>
    );
  }

  const gastosN = Math.max(0, Math.round(Number(gastos) || 0));
  const entregadoN = Math.max(0, Math.round(Number(entregado) || 0));
  const { esperado, diferencia, estado } = calcularRendicion(recaudado, gastosN, entregadoN, base);
  const t = TONO[estado];

  // Cobros en la cola offline que no subieron. SINCRONIZANDO (se reintentan solos)
  // → bloquean el cierre para no rendir un faltante fantasma. ATASCADOS (agotaron
  // los reintentos: el crédito se finalizó/reasignó mientras estaba sin señal) →
  // NO bloquean; se muestran aparte y el cobrador los descarta o re-registra.
  const cobrosPago = ops.filter((o) => o.tipo === "pago");
  const cobrosPend = cobrosPago.filter((o) => !opAtascada(o));
  const cobrosAtascados = cobrosPago.filter((o) => opAtascada(o));
  const montoPend = cobrosPend.reduce((s, o) => s + (o.monto ?? 0), 0);
  const hayColaPendiente = cobrosPend.length > 0;

  const cerrar = () => {
    setError(null);
    startTransition(async () => {
      const res = await cerrarJornada({ gastos: gastosN, entregado: entregadoN, notas });
      if (res.ok) {
        setConfirmar(false);
        router.refresh();
      } else {
        setError(res.error);
        setConfirmar(false);
      }
    });
  };

  return (
    <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
      <span className="text-[14px] font-extrabold text-tinta">Cerrar jornada</span>

      {base > 0 && (
        <div className="mt-2 flex items-end justify-between rounded-[12px] bg-[#EEF3FF] px-3 py-2.5">
          <span className="text-[12px] font-semibold text-[#1E47C8]">Base recibida (la devolvés)</span>
          <span className="text-[16px] font-black tabular-nums text-[#1E47C8]">{UYU(base)}</span>
        </div>
      )}

      <div className="mt-2 flex items-end justify-between rounded-[12px] bg-[#F4F6FB] px-3 py-2.5">
        <span className="text-[12px] font-semibold text-gris">Recaudado hoy</span>
        <span className="text-[18px] font-black tabular-nums text-verde">
          {UYU(recaudado)}
          <span className="ml-1 text-[11px] font-semibold text-gris">· {cobrosCantidad} cobro{cobrosCantidad === 1 ? "" : "s"}</span>
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Campo label="Gastos de ruta">
          <input
            inputMode="numeric"
            value={gastos}
            onChange={(e) => { setEditado(true); setGastos(e.target.value.replace(/[^\d]/g, "")); }}
            placeholder="0"
            className="min-h-11 w-full rounded-[11px] border border-[#DCE3F4] px-3 py-3 text-[16px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
        <Campo label="Efectivo que entrego">
          <input
            inputMode="numeric"
            value={entregado}
            onChange={(e) => { setEditado(true); setEntregado(e.target.value.replace(/[^\d]/g, "")); }}
            placeholder="0"
            className="min-h-11 w-full rounded-[11px] border border-[#DCE3F4] px-3 py-3 text-[16px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
      </div>
      {gastosHoy > 0 && (
        <p className="mt-1.5 px-1 text-[11px] font-medium text-[#8A93AD]">
          Incluye {UYU(gastosHoy)} de gastos que cargaste hoy. Podés ajustarlo.
        </p>
      )}

      {/* Gastos pedidos pero SIN aprobar: no están en el "esperado". Si el cobrador
          ya gastó esa plata, sin este aviso le saldría un faltante fantasma. Se le
          ofrece SUMARLOS (decisión suya), nunca se restan solos (control anti-fuga). */}
      {gastosPendientes > 0 && (
        <div className="mt-2 flex flex-col items-start gap-1.5 rounded-[12px] border border-[#DCE3F4] bg-[#F7F9FD] px-3 py-2.5">
          <span className="text-[12px] font-bold text-[#5A6B94]">
            Tenés {UYU(gastosPendientes)} en gastos pendientes de aprobación.
          </span>
          <span className="text-[11.5px] font-medium text-[#8A93AD]">
            No cuentan en el “Debería entregar” hasta que el admin los apruebe. Si ya
            sacaste esa plata, sumalos así no te marca un faltante que no es real.
          </span>
          <button
            type="button"
            onClick={() => {
              const nuevoGastos = gastosHoy + gastosPendientes;
              // Si el cobrador aún NO tocó los campos, el `entregado` sigue en el
              // prefijado bruto (recaudado − gastosHoy). Al declarar que ya gastó
              // estos pendientes, su efectivo a entregar cae igual → bajamos ambos
              // en espejo (como el prefijado de gastosHoy) para que CUADRE, no que
              // quede un sobrante fantasma con un entregado sobre-declarado. Si ya
              // escribió su efectivo real, NO lo pisamos (respeta su conteo físico;
              // el campo sigue editable y la diferencia se ve en vivo).
              if (!editado) setEntregado(String(Math.max(0, base + recaudado - nuevoGastos)));
              setEditado(true);
              setGastos(String(nuevoGastos));
            }}
            className="rounded-full border border-[#C7D2EC] bg-white px-3 py-1.5 text-[11.5px] font-bold text-azul active:scale-95"
          >
            Sumar {UYU(gastosPendientes)} a gastos
          </button>
        </div>
      )}

      {/* A entregar + diferencia en vivo */}
      <div className="mt-2.5 flex items-center justify-between rounded-[12px] px-3 py-2.5" style={{ background: t.bg }}>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold" style={{ color: t.fg }}>Debería entregar</span>
          <span className="text-[15px] font-extrabold tabular-nums" style={{ color: t.fg }}>{UYU(esperado)}</span>
        </div>
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-[12px] font-black" style={{ color: t.fg }}>
          {estado === "cuadra" ? "Cuadra ✓" : `${estado === "faltante" ? "Falta" : "Sobra"} ${UYU(Math.abs(diferencia))}`}
        </span>
      </div>

      <input
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        maxLength={300}
        placeholder="Nota (opcional): motivo del faltante, etc."
        className="mt-2.5 w-full rounded-[11px] border border-[#DCE3F4] px-3 py-2 text-[16px] outline-none focus:border-azul"
      />

      {error && <p className="mt-2 text-[12px] font-semibold text-[#C0392B]">{error}</p>}

      {/* Anti-faltante-fantasma: cobros sin sincronizar todavía no están en el
          "recaudado" del servidor. Avisar y bloquear el cierre hasta que suban. */}
      {hayColaPendiente && (
        <div className="mt-3 flex flex-col gap-1 rounded-[12px] border border-[#F0D9A8] bg-[#FEFBF3] px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#9A6A0E]">
            ⏳ Tenés {cobrosPend.length} cobro{cobrosPend.length === 1 ? "" : "s"} sin subir
            {montoPend > 0 ? ` (${UYU(montoPend)})` : ""}
          </span>
          <span className="text-[11.5px] font-medium text-[#9A6A0E]">
            El recaudado todavía no los incluye. Esperá a tener señal para que suban; si cerrás ahora te
            va a marcar un faltante que no es real.
          </span>
        </div>
      )}

      {/* Cobros ATASCADOS: no suben (el crédito se cerró/reasignó). No bloquean el
          cierre; el cobrador los descarta (y si el cobro fue real, lo re-registra). */}
      {cobrosAtascados.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-[#F3C0B8] bg-[#FEF6F3] px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#C0392B]">
            ⚠️ {cobrosAtascados.length} cobro{cobrosAtascados.length === 1 ? "" : "s"} no se pudo subir
          </span>
          <span className="text-[11.5px] font-medium text-[#9A4436]">
            Puede que ese crédito se haya cerrado o cambiado de cobrador. Si el cobro fue real, registralo de
            nuevo en la ficha del cliente. Descartá el que no corresponda para poder cerrar.
          </span>
          {cobrosAtascados.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 border-t border-[#F3D6CF] pt-1.5">
              <span className="min-w-0 truncate text-[12px] font-semibold text-tinta">
                {o.clienteNombre} · {o.monto != null ? UYU(o.monto) : "cuota"}
              </span>
              <button
                type="button"
                onClick={() => quitar(o.id)}
                className="flex-shrink-0 rounded-full border border-[#D6A79E] px-2.5 py-1 text-[11.5px] font-bold text-[#C0392B] active:scale-95"
              >
                Descartar
              </button>
            </div>
          ))}
        </div>
      )}

      {!confirmar ? (
        <button
          type="button"
          onClick={() => setConfirmar(true)}
          disabled={hayColaPendiente}
          className="mt-3 w-full rounded-[13px] bg-[#2453DC] py-3 text-[15px] font-extrabold text-white active:scale-[0.99] disabled:opacity-50"
        >
          {hayColaPendiente ? "Esperá a que suban los cobros…" : "Cerrar jornada"}
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-center text-[12.5px] font-semibold text-gris">
            Vas a rendir {UYU(entregadoN)}. El cierre no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(false)}
              disabled={pendiente}
              className="flex-1 rounded-[13px] border border-[#DCE3F4] py-3 text-[14px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={pendiente}
              className="flex-1 rounded-[13px] bg-[#1FA971] py-3 text-[14px] font-extrabold text-white disabled:opacity-60"
            >
              {pendiente ? "Cerrando…" : "Confirmar cierre"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-bold text-gris">{label}</span>
      {children}
    </label>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] bg-[#F7F9FD] px-2.5 py-1.5">
      <span className="text-[11.5px] font-medium text-gris">{k}</span>
      <span className="text-[13px] font-extrabold tabular-nums text-tinta">{v}</span>
    </div>
  );
}

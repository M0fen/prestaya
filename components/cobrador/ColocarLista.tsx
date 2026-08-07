"use client";
// ─────────────────────────────────────────────────────────────────────────
//  LAS DOS PUERTAS PARA COLOCAR CAPITAL (modelo de Carlos, 07-08):
//
//   · RENOVAR      — repite el crédito TAL CUAL lo tenía: mismo monto, misma
//                    cuota, mismas cuotas. SIN campos, sin decisiones, un toque.
//                    Menos decisiones en la vereda = menos dedazos, y acá el
//                    dedazo es plata.
//   · NUEVA VENTA  — el MISMO momento, pero eligiendo monto y cuotas. Si el
//                    cliente viene de terminar un crédito, va por el camino de
//                    renovación (cierra el anterior en la misma operación); si no
//                    tiene nada que cerrar, es un alta común.
//
//  Las dos se entran desde la FICHA DEL CLIENTE, que es donde el cobrador ya está
//  parado. La lista completa queda como respaldo, con buscador — y el que NO se
//  puede colocar aparece igual, con el motivo: antes desaparecía sin decir nada y
//  el cobrador creía que la app estaba rota (reporte de campo 07-08).
//
//  La pantalla responde, sin que nadie la explique, las cuatro cosas que el
//  cobrador le dice al cliente en voz alta: cuánto le doy, cuánto paga por día,
//  cuánto paga en total y cuándo empieza. Confirmación de dos toques antes de
//  colocar capital, y el PRIMER toque ya dice el número.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UYU } from "@/lib/format";
import { renovarDesdeCalle, nuevaVentaDesdeCalle } from "@/lib/acciones/cobradorCredito";
import type { FrecuenciaPrestamo } from "@/types/db";
import {
  calcularCuotaCreditoNuevo,
  interesDeBase,
  INTERES_DEFECTO_PCT,
} from "@/lib/creditoNuevo";

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
  /** Renovar: monto SUGERIDO del crédito nuevo = el mismo que terminó de pagar.
   *  Lo calcula el servidor con la misma función que después valida el alta. */
  montoNuevo?: number;
  /** Renovar: cuota del crédito NUEVO. */
  cuotaNueva?: number;
  /** Supera el tope del sistema: el toque manda el pedido al admin, no lo crea. */
  requiereAprobacion?: boolean;
  /** Deuda viva en sus OTROS créditos activos (0 si no tiene). Se avisa, no bloquea. */
  deudaHermano?: number;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "24 cuotas diarias" se lee mejor que "24 cuotas · diario". */
function etiquetaFrec(f: string): string {
  if (f === "semanal") return "semanas";
  if (f === "quincenal") return "quincenas";
  if (f === "mensual") return "meses";
  return "días";
}

export interface NoElegibleVista {
  clienteId: string;
  nombre: string;
  documento: string | null;
  motivo: string;
  queHacer: string | null;
}

export function ColocarLista({
  modo,
  candidatos,
  noElegibles = [],
  clienteFoco = null,
}: {
  modo: "renovar" | "venta";
  candidatos: Candidato[];
  /** Clientes de la ruta que HOY no se pueden colocar, con el motivo. Solo se
   *  muestran AL BUSCAR: no ensucian la lista, pero el que busca los encuentra. */
  noElegibles?: NoElegibleVista[];
  /** Se llegó desde la ficha de un cliente concreto (`?cliente=<id>`): se abre
   *  directo en él, sin hacerle buscar en una lista de 120 nombres a alguien que
   *  ya tiene a la persona enfrente. */
  clienteFoco?: string | null;
}) {
  const [q, setQ] = useState("");
  const soloFoco = clienteFoco
    ? candidatos.filter((c) => c.clienteId === clienteFoco)
    : null;
  const focoBloqueado = clienteFoco
    ? (noElegibles.find((c) => c.clienteId === clienteFoco) ?? null)
    : null;
  const coincide = (nombre: string, documento: string | null, t: string, dig: string) =>
    norm(nombre).includes(t) ||
    (dig.length >= 3 && (documento ?? "").replace(/\D/g, "").includes(dig));

  const filtrados = useMemo(() => {
    const t = norm(q);
    if (!t) return candidatos;
    const dig = q.replace(/\D/g, "");
    return candidatos.filter((c) => coincide(c.nombre, c.documento, t, dig));
  }, [q, candidatos]);

  // ⚠️ Los que NO se pueden aparecen SOLO al buscar. Antes desaparecían sin decir
  // nada y el cobrador se quedaba parado frente al cliente creyendo que la app
  // estaba rota (reporte de campo 07-08). Mostrarlos siempre sería ruido; que el
  // que los busca los encuentre —con el motivo— es lo que hacía falta.
  const bloqueados = useMemo(() => {
    const t = norm(q);
    if (!t) return [];
    const dig = q.replace(/\D/g, "");
    return noElegibles.filter((c) => coincide(c.nombre, c.documento, t, dig));
  }, [q, noElegibles]);

  if (candidatos.length === 0 && noElegibles.length === 0) {
    return (
      <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] leading-[1.5] font-medium text-gris">
        {modo === "renovar"
          ? "Ninguno de tus clientes terminó de pagar todavía. Cuando alguno complete su crédito, aparece acá para renovarlo de un toque."
          : "No tenés clientes libres para una venta nueva. Aparecen los que ya no tienen crédito activo y alguna vez tuvieron uno."}
      </p>
    );
  }

  // Se llegó desde la ficha de UNA persona: se le muestra ESA, abierta, y nada más.
  // Hacerle buscar en una lista de 120 nombres a alguien que tiene al cliente
  // enfrente es exactamente lo que hizo que el operador no encontrara la venta.
  if (clienteFoco) {
    return (
      <div className="flex flex-col gap-3">
        {soloFoco && soloFoco.length > 0 ? (
          soloFoco.map((c) => (
            <Tarjeta key={c.clienteId + (c.prestamoId ?? "")} c={c} modo={modo} abrirYa />
          ))
        ) : focoBloqueado ? (
          <TarjetaBloqueada c={focoBloqueado} />
        ) : (
          <div className="rounded-[14px] border border-borde bg-white px-4 py-5 text-center">
            <p className="text-[13px] leading-[1.5] font-semibold text-tinta">
              A esta persona no le podés colocar {modo === "renovar" ? "una renovación" : "un crédito"} ahora.
            </p>
            <p className="mt-1 text-[12px] leading-[1.5] font-medium text-gris">
              Puede ser que sea su primer crédito (lo da la oficina) o que su crédito sea de
              otro cobrador. Miralo en su cartón.
            </p>
          </div>
        )}
        <a
          href="/cobrador/colocar?modo=venta"
          className="min-h-11 rounded-[13px] border border-borde bg-white text-center text-[13px] font-bold leading-[44px] text-azul"
        >
          Ver todos mis clientes
        </a>
      </div>
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

      {candidatos.length === 0 && !q && (
        <p className="rounded-[14px] bg-white px-4 py-5 text-center text-[13px] leading-[1.5] font-medium text-gris">
          {modo === "renovar"
            ? "Ninguno de tus clientes terminó de pagar todavía."
            : "No tenés clientes libres para una venta nueva ahora mismo."}
          <br />
          Buscá a la persona igual: te decimos por qué no aparece.
        </p>
      )}

      {filtrados.map((c) => (
        <Tarjeta key={c.clienteId + (c.prestamoId ?? "")} c={c} modo={modo} />
      ))}

      {bloqueados.map((c) => (
        <TarjetaBloqueada key={`no-${c.clienteId}`} c={c} />
      ))}

      {q && filtrados.length === 0 && bloqueados.length === 0 && (
        <div className="rounded-[14px] border border-borde bg-white px-4 py-5 text-center">
          <p className="text-[13px] leading-[1.5] font-semibold text-tinta">
            No encontramos a nadie con “{q}” en tu ruta.
          </p>
          <p className="mt-1 text-[12px] leading-[1.5] font-medium text-gris">
            Probá con el apellido o la cédula. Si la persona todavía no está en el sistema,
            dala de alta con <strong className="font-bold">Censar cliente nuevo</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

/** El cliente existe en la ruta pero HOY no se le puede colocar. Se dice por qué
 *  y qué hacer — nunca un callejón sin salida. */
function TarjetaBloqueada({ c }: { c: NoElegibleVista }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[16px] border border-[#F0DCA8] bg-[#FDF8EC] p-4">
      <span className="text-[15px] font-extrabold text-tinta">{c.nombre}</span>
      <span className="text-[12.5px] leading-[1.45] font-bold text-[#8A6D1E]">{c.motivo}</span>
      {c.queHacer && (
        <span className="text-[12px] leading-[1.45] font-medium text-[#8A6D1E]">{c.queHacer}</span>
      )}
      <a
        href={`/cobrador/cliente/${c.clienteId}`}
        className="mt-1 min-h-11 self-start rounded-full border border-[#E0CB93] bg-white px-4 text-[12.5px] font-bold leading-[44px] text-[#8A6D1E] active:scale-95"
      >
        Ver su cartón
      </a>
    </div>
  );
}

function Tarjeta({
  c,
  modo,
  abrirYa = false,
}: {
  c: Candidato;
  modo: "renovar" | "venta";
  /** Se entró desde la ficha de este cliente: ya está decidido de quién se trata. */
  abrirYa?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abrirYa);
  const [confirmar, setConfirmar] = useState(false);
  /** Monto y cuotas de la NUEVA VENTA. Arrancan en los del último crédito: lo más
   *  común es repetir, y así el que solo quiere cambiar UNA cosa toca UNA cosa. */
  const [monto, setMonto] = useState(String(c.montoNuevo ?? c.monto));
  const [cuotas, setCuotas] = useState(String(c.totalDias));
  const [msg, setMsg] = useState<string | null>(null);
  const [okTxt, setOkTxt] = useState<string | null>(null);
  /** El resultado fue "ya estaba hecho", no "recién lo creé": se pinta distinto. */
  const [eraRepetido, setEraRepetido] = useState(false);
  const [pendiente, start] = useTransition();

  const montoN = Math.round(Number(monto) || 0);
  const cuotasN = Math.round(Number(cuotas) || 0);
  const techo = c.techo;
  const excede = montoN > techo;
  /** Lo que se le entrega al RENOVAR: el mismo monto del crédito que terminó. */
  const sugeridoRenov = c.montoNuevo ?? c.monto;

  // Cuota estimada de una VENTA nueva. Se calcula con la MISMA función pura que
  // usa el servidor, arrastrando la tasa del último crédito del cliente: el que
  // vuelve no estrena condiciones. Es una estimación para mostrar (el servidor
  // recalcula y manda); sin ella el cobrador no podía decirle al cliente cuánto
  // iba a pagar por día hasta después de crear el crédito.
  const cuotaVenta = useMemo(() => {
    if (!(montoN > 0) || !(cuotasN > 0)) return 0;
    const base = { monto: c.monto, cuota: c.cuota, totalDias: c.totalDias };
    return calcularCuotaCreditoNuevo(base, montoN, cuotasN, interesDeBase(base) ?? INTERES_DEFECTO_PCT);
  }, [montoN, cuotasN, c.monto, c.cuota, c.totalDias]);

  // Cuándo empieza a pagar: los créditos nacen el PRÓXIMO día de cobro (no hoy),
  // y el cobrador se lo tiene que poder decir al cliente sin hacer la cuenta.
  const primerCobro = useMemo(() => {
    const f = new Date();
    f.setHours(0, 0, 0, 0);
    f.setDate(f.getDate() + 1);
    if (f.getDay() === 0) f.setDate(f.getDate() + 1); // domingo no se cobra
    const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    return `el ${dias[f.getDay()]} ${f.getDate()}`;
  }, []);

  const colocar = () =>
    start(async () => {
      setMsg(null);
      try {
        // RENOVAR = repetir tal cual: no se manda monto ni cuotas, los pone el
        // servidor desde el crédito anterior. Cero decisiones, cero dedazos.
        //
        // NUEVA VENTA = el mismo momento pero con términos propios. Si el cliente
        // viene de TERMINAR un crédito (`prestamoId`), va por el camino de
        // RENOVACIÓN con monto y cuotas propios: así se cierra el anterior en la
        // misma operación atómica. Si no tiene crédito que cerrar, es un alta común.
        const r =
          modo === "renovar"
            ? await renovarDesdeCalle({ clienteId: c.clienteId, prestamoId: c.prestamoId! })
            : c.prestamoId
              ? await renovarDesdeCalle({
                  clienteId: c.clienteId,
                  prestamoId: c.prestamoId,
                  monto: montoN,
                  cuotas: cuotasN,
                })
              : await nuevaVentaDesdeCalle({
                  clienteId: c.clienteId,
                  monto: montoN,
                  totalDias: cuotasN,
                  frecuencia: c.frecuencia as FrecuenciaPrestamo,
                });
        if (r.ok) {
          // Puede haber quedado PEDIDO a la oficina (supera el tope) en vez de
          // creado: el mensaje lo dice, para que el cobrador no le prometa al
          // cliente un crédito que todavía tiene que aprobar el admin.
          // ⚠️ "Ya estaba hecho" NO es lo mismo que "lo acabo de crear". El
          // reintento tras un corte de señal devuelve `repetido`, y si se muestra
          // el mismo verde el cobrador cree que recién colocó el capital y le
          // entrega la plata al cliente DE NUEVO. Se dice distinto, explícito.
          setOkTxt(
            "solicitado" in r
              ? r.mensaje
              : r.repetido
                ? `Ya estaba renovado ✓ — no se creó otro. Si ya le entregaste la plata, no se la des de nuevo.`
                : r.cuota
                  ? `Listo ✓ · cuota ${UYU(r.cuota)}`
                  : "Listo ✓",
          );
          setEraRepetido("solicitado" in r ? false : Boolean(r.repetido));
          router.refresh();
        } else {
          setMsg(r.error);
          setConfirmar(false);
        }
      } catch {
        // Red caída a mitad de la colocación: aviso inline (antes reventaba al
        // error boundary y el cobrador no sabía si el crédito se creó). El
        // reintento es seguro: la idempotencia por op_id no duplica el capital.
        setMsg("Sin señal: no sabemos si entró. Con conexión, tocá de nuevo — no se duplica.");
        setConfirmar(false);
      }
    });

  if (okTxt) {
    // Verde = se colocó recién. Ámbar = ya estaba hecho (reintento tras un corte
    // de señal): mismo "ok" para el servidor, cosa MUY distinta para el bolsillo.
    const tono = eraRepetido
      ? { borde: "#F0DCA8", fondo: "#FDF8EC", texto: "#8A6D1E" }
      : { borde: "#BEEBD5", fondo: "#F0FBF5", texto: "#157A50" };
    return (
      <div className="rounded-[16px] border p-4" style={{ borderColor: tono.borde, background: tono.fondo }}>
        <span className="text-[14px] font-extrabold" style={{ color: tono.texto }}>{c.nombre}</span>
        <p className="mt-0.5 text-[12.5px] leading-[1.45] font-bold" style={{ color: tono.texto }}>{okTxt}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-tinta">{c.nombre}</span>
          <span className="text-[11.5px] font-semibold text-gris tabular-nums">
            {modo === "renovar"
              ? "Terminó de pagar ✓"
              : (c.deudaHermano ?? 0) >= 1
                ? "Está pagando · se le puede dar otro"
                : "Sin crédito activo"}
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

      {/* El cliente terminó ESTE crédito pero le queda deuda en otro. Antes esto
          lo sacaba de la lista sin decir nada y el cobrador creía que la app
          estaba rota; ahora se avisa y la decisión de renovar igual es humana. */}
      {/* Deuda VIVA en sus otros créditos. En RENOVAR avisa que terminó este pero
          debe en otro; en VENTA es todavía más importante, porque se le está
          poniendo plata nueva encima de una deuda abierta. La decisión es humana:
          se informa, no se bloquea (un cliente puede tener dos créditos a la vez). */}
      {(c.deudaHermano ?? 0) >= 1 && (
        <p className="rounded-[11px] bg-[#FDF3E2] px-3 py-2 text-[11.5px] leading-[1.4] font-bold text-[#8A6D1E]">
          ⚠️ {modo === "renovar" ? "Tiene otro crédito abierto" : "Ya tiene un crédito abierto"} al
          que le falta {UYU(c.deudaHermano ?? 0)}.
        </p>
      )}

      {abierto && (
        <>
          {modo === "renovar" ? (
            // Renovar viene con el +20% ya puesto, pero EDITABLE: el cobrador está
            // ⚠️ RENOVAR = REPETIR TAL CUAL. Sin campos, sin decisiones (regla de
            // Carlos, 07-08): el crédito vuelve a nacer con el mismo monto, la misma
            // cuota y las mismas cuotas que el cliente ya venía pagando. Cambiar
            // algo es "Nueva venta", que es la otra puerta. Menos decisiones en la
            // vereda = menos dedazos, y acá el dedazo es plata.
            <div className="flex flex-col gap-2.5 rounded-[13px] bg-[#F7F9FD] p-3">
              <span className="text-[12px] font-extrabold text-tinta">
                Se repite el crédito tal cual lo tenía
              </span>
              <div className="grid grid-cols-2 gap-2 rounded-[11px] bg-white p-2.5">
                <Dato k="Le entregás" v={UYU(sugeridoRenov)} />
                <Dato k="Cuota" v={UYU(c.cuotaNueva ?? c.cuota)} />
                <Dato k="Cuotas" v={`${c.totalDias} ${etiquetaFrec(c.frecuencia)}`} />
                <Dato k="Paga en total" v={UYU((c.cuotaNueva ?? c.cuota) * c.totalDias)} />
              </div>
              <span className="text-[11.5px] leading-[1.4] font-semibold text-gris">
                Empieza a pagar {primerCobro}. Hoy recibe la plata, mañana arranca.
              </span>
              {c.requiereAprobacion && (
                <span className="rounded-[10px] bg-[#FDF3E2] px-2.5 py-2 text-[11.5px] leading-[1.45] font-bold text-[#8A6D1E]">
                  Este monto lo tiene que aprobar la oficina. Al confirmar se manda el pedido.
                  <br />
                  <strong>Todavía NO le entregues la plata.</strong>
                </span>
              )}
              {/* La salida para el que necesita otro número: no es un callejón. */}
              <a
                href={`/cobrador/colocar?modo=venta&cliente=${c.clienteId}`}
                className="self-start text-[12px] font-bold text-azul underline"
              >
                ¿Necesita otro monto o más cuotas? → Nueva venta
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-[13px] bg-[#F7F9FD] p-3">
              <span className="text-[11.5px] font-bold text-gris">
                {c.prestamoId
                  ? `Terminó de pagar ${UYU(c.monto)} en ${c.totalDias} ${etiquetaFrec(c.frecuencia)}`
                  : `Su último crédito fue de ${UYU(c.monto)}`}
              </span>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[12px] font-extrabold text-tinta">¿Cuánto le das?</span>
                  <div className="flex items-center gap-1.5 rounded-[11px] border-2 border-[#C7D2EC] bg-white px-3">
                    <span className="text-[18px] font-black text-[#8A93AD]">$</span>
                    <input
                      inputMode="numeric"
                      value={monto}
                      onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))}
                      className="w-full min-h-[52px] bg-transparent text-[22px] font-black tabular-nums text-tinta outline-none"
                    />
                  </div>
                </label>
                <label className="flex w-24 flex-col gap-1">
                  <span className="text-[12px] font-extrabold text-tinta">Cuotas</span>
                  <input
                    inputMode="numeric"
                    value={cuotas}
                    onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ""))}
                    className="min-h-[52px] rounded-[11px] border-2 border-[#C7D2EC] bg-white px-3 text-[22px] font-black tabular-nums text-tinta outline-none"
                  />
                </label>
              </div>

              {/* Qué va a pagar el cliente: hasta ahora el cobrador tenía que
                  calcularlo de memoria para poder decírselo. */}
              {montoN > 0 && cuotasN > 0 && !excede && (
                <>
                  <div className="grid grid-cols-3 gap-2 rounded-[11px] bg-white p-2.5">
                    <Dato k="Cuota" v={UYU(cuotaVenta)} />
                    <Dato k="Cuotas" v={`${cuotasN} ${etiquetaFrec(c.frecuencia)}`} />
                    <Dato k="Paga en total" v={UYU(cuotaVenta * cuotasN)} />
                  </div>
                  <span className="text-[11.5px] leading-[1.4] font-semibold text-gris">
                    Empieza a pagar {primerCobro}. Hoy recibe la plata, mañana arranca.
                  </span>
                </>
              )}

              <span
                className={`text-[11.5px] leading-[1.4] font-semibold ${
                  excede ? "text-[#C0392B]" : "text-gris"
                }`}
              >
                {excede
                  ? c.prestamoId
                    ? `${UYU(montoN)} pasa los ${UYU(techo)} que podés dar solo. Al confirmar se manda el pedido a la oficina — todavía NO le entregues la plata.`
                    : `${UYU(montoN)} pasa lo que podés dar solo. El máximo para este cliente es ${UYU(techo)} — para más, pedíselo a tu supervisor.`
                  : `Podés darle hasta ${UYU(techo)} vos solo.`}
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
              disabled={pendiente || (modo === "venta" && ((excede && !c.prestamoId) || montoN <= 0 || cuotasN <= 0))}
              onClick={() => (confirmar ? colocar() : setConfirmar(true))}
              className="min-h-11 flex-1 rounded-[13px] bg-[#1FA971] text-[13px] font-extrabold text-white disabled:opacity-50"
            >
              {/* El primer toque YA dice qué va a pasar y con qué número: antes
                  decía solo "Confirmar" y el cobrador confirmaba a ciegas. */}
              {pendiente
                ? "Creando…"
                : (() => {
                    // RENOVAR va por el monto del crédito anterior (no hay campos);
                    // VENTA por lo que tipeó. Y "pedir a la oficina" solo cuando de
                    // verdad se pasa: el botón nunca promete lo que no va a pasar.
                    const n = modo === "renovar" ? sugeridoRenov : montoN;
                    const aOficina =
                      modo === "renovar" ? !!c.requiereAprobacion : excede && !!c.prestamoId;
                    if (aOficina)
                      return confirmar
                        ? `Sí, pedir ${UYU(n)} a la oficina`
                        : `Pedir ${UYU(n)} a la oficina`;
                    return confirmar ? `Sí, entregarle ${UYU(n)}` : `Entregarle ${UYU(n)}`;
                  })()}
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

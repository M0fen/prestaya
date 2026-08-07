"use client";
// ─────────────────────────────────────────────────────────────────────────
//  RENOVAR y NUEVA VENTA desde la calle.
//
//  RENOVAR arranca en el MISMO monto que el cliente terminó de pagar (regla de
//  Carlos, 06-08: "si terminó 60k, se renueva en 60k") y es EDITABLE: el cobrador
//  está frente al cliente. Hasta +20% lo aprueba él solo; por encima se le pide a
//  la oficina, sin rebotar. El +20% NUNCA fue un aumento automático de capital.
//
//  La pantalla tiene que responder, sin que nadie la explique, las cuatro cosas
//  que el cobrador le dice al cliente en voz alta: cuánto le doy, cuánto paga por
//  día, cuánto paga en total y cuándo empieza. Antes solo pedía un monto pelado.
//  Confirmación de dos toques antes de colocar capital, y el PRIMER toque ya dice
//  el número (misma protección que el cobro: nada de plata sale de un solo tap).
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
  /** Monto de la RENOVACIÓN, editable. Arranca en el MISMO monto que terminó de
   *  pagar (lo manda el server): renovar es repetir el crédito, no subirlo. */
  const [montoRenov, setMontoRenov] = useState(String(c.montoNuevo ?? c.monto));
  const [cuotas, setCuotas] = useState(String(c.totalDias));
  /** Cuotas de la RENOVACIÓN, editables. Arrancan en las del crédito anterior. */
  const [cuotasRenov, setCuotasRenov] = useState(String(c.totalDias));
  const [msg, setMsg] = useState<string | null>(null);
  const [okTxt, setOkTxt] = useState<string | null>(null);
  /** El resultado fue "ya estaba hecho", no "recién lo creé": se pinta distinto. */
  const [eraRepetido, setEraRepetido] = useState(false);
  const [pendiente, start] = useTransition();

  const montoN = Math.round(Number(monto) || 0);
  const cuotasN = Math.round(Number(cuotas) || 0);
  const techo = c.techo;
  const excede = montoN > techo;
  // Renovar: arranca en el MISMO monto que terminó y es EDITABLE (el cobrador está
  // frente al cliente). El servidor revalida SIEMPRE: hasta el techo lo crea, por
  // encima genera la solicitud para el admin, y pasado el máximo lo rechaza.
  const sugeridoRenov = c.montoNuevo ?? c.monto;
  const nuevoMonto = Math.round(Number(montoRenov) || 0) || sugeridoRenov;
  const renovEditado = nuevoMonto !== sugeridoRenov;
  // ⚠️ Se compara contra el TECHO (+20%), NO contra el sugerido. Comparando contra
  // el sugerido, un monto ENTRE el sugerido y el techo pintaba el aviso ámbar y el
  // botón "pedir a la oficina" —"todavía no le entregues la plata"— mientras el
  // servidor lo aprobaba solo y CREABA el crédito en el acto: el cliente empezaba a
  // pagar mañana un préstamo que nunca recibió, y al cobrador se le descontaba de
  // la caja un capital que seguía en su bolsillo.
  const pideAprobacion = modo === "renovar" && (nuevoMonto > techo || !!c.requiereAprobacion);
  const cuotasRenovN = Math.round(Number(cuotasRenov) || 0) || c.totalDias;
  const cuotasEditadas = cuotasRenovN !== c.totalDias;
  // Total que va a pagar el cliente = monto × SU tasa (la del crédito anterior).
  // Cambiar las cuotas NO cambia ese total: lo reparte en más o menos pagos.
  const totalAPagarRenov =
    sugeridoRenov > 0
      ? Math.round(((c.cuotaNueva ?? c.cuota) * c.totalDias * nuevoMonto) / sugeridoRenov)
      : (c.cuotaNueva ?? c.cuota) * c.totalDias;
  const nuevaCuota = cuotasRenovN > 0 ? Math.round(totalAPagarRenov / cuotasRenovN) : 0;

  // Atajos de monto: tipear en la calle es de donde salen los ceros de más. El
  // MISMO monto es lo normal (regla del negocio); los otros dos son los pedidos
  // que aparecen de verdad. Se ocultan los que se pasan del techo del cobrador,
  // así ningún atajo lo manda sin querer a la cola de la oficina.
  const atajosRenov = useMemo(() => {
    const base = sugeridoRenov;
    const opciones = [
      { etiqueta: `El mismo · ${UYU(base)}`, monto: base },
      { etiqueta: `+10% · ${UYU(Math.round(base * 1.1))}`, monto: Math.round(base * 1.1) },
      { etiqueta: `+20% · ${UYU(Math.round(base * 1.2))}`, monto: Math.round(base * 1.2) },
    ];
    return opciones.filter((o, i) => i === 0 || (o.monto <= techo && o.monto !== base));
  }, [sugeridoRenov, techo]);

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
        const r =
          modo === "renovar"
            ? await renovarDesdeCalle({ clienteId: c.clienteId, prestamoId: c.prestamoId!, monto: nuevoMonto, cuotas: cuotasRenovN })
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

      {/* El cliente terminó ESTE crédito pero le queda deuda en otro. Antes esto
          lo sacaba de la lista sin decir nada y el cobrador creía que la app
          estaba rota; ahora se avisa y la decisión de renovar igual es humana. */}
      {modo === "renovar" && (c.deudaHermano ?? 0) >= 1 && (
        <p className="rounded-[11px] bg-[#FDF3E2] px-3 py-2 text-[11.5px] font-bold text-[#8A6D1E]">
          ⚠️ Tiene otro crédito abierto al que le falta {UYU(c.deudaHermano ?? 0)}.
        </p>
      )}

      {abierto && (
        <>
          {modo === "renovar" ? (
            // Renovar viene con el +20% ya puesto, pero EDITABLE: el cobrador está
            // frente al cliente y a veces el número tiene que ser otro. Si pide más
            // que su techo, no rebota — se le pide a la oficina.
            <div className="flex flex-col gap-2.5 rounded-[13px] bg-[#F7F9FD] p-3">
              {/* 1) DE CUÁNTO VENÍA. Sin esto el cobrador no tiene contra qué
                  comparar el número que va a escribir. */}
              <span className="text-[11.5px] font-bold text-gris">
                Terminó de pagar {UYU(c.monto)}
              </span>

              {/* 2) EL MONTO, grande y obviamente editable. El campo con el signo $
                  adentro y el teclado numérico: es LO ÚNICO que se decide acá. */}
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[12px] font-extrabold text-tinta">
                    ¿Por cuánto se lo renovás?
                  </span>
                  <div className="flex items-center gap-1.5 rounded-[11px] border-2 border-[#C7D2EC] bg-white px-3">
                    <span className="text-[18px] font-black text-[#8A93AD]">$</span>
                    <input
                      inputMode="numeric"
                      value={montoRenov}
                      onChange={(e) => {
                        setMontoRenov(e.target.value.replace(/\D/g, ""));
                        setConfirmar(false);
                      }}
                      className="w-full min-h-[52px] bg-transparent text-[22px] font-black tabular-nums text-tinta outline-none"
                    />
                  </div>
                </label>
                {/* CUOTAS editables (pedido de Carlos, 07-08): el cliente a veces
                    necesita la cuota más baja aunque tarde más. Cambiarlas NO cambia
                    lo que paga en total — reparte ese total en más o menos cuotas. */}
                <label className="flex w-[92px] flex-col gap-1">
                  <span className="text-[12px] font-extrabold text-tinta">Cuotas</span>
                  <input
                    inputMode="numeric"
                    value={cuotasRenov}
                    onChange={(e) => {
                      setCuotasRenov(e.target.value.replace(/\D/g, ""));
                      setConfirmar(false);
                    }}
                    className="min-h-[52px] rounded-[11px] border-2 border-[#C7D2EC] bg-white px-3 text-[22px] font-black tabular-nums text-tinta outline-none"
                  />
                </label>
              </div>

              {/* 3) ATAJOS. Tipear en la calle es de donde salen los ceros de más.
                  El mismo monto es lo normal; los otros dos son los pedidos reales. */}
              <div className="flex flex-wrap gap-1.5">
                {atajosRenov.map((a) => (
                  <button
                    key={a.etiqueta}
                    type="button"
                    onClick={() => {
                      setMontoRenov(String(a.monto));
                      setConfirmar(false);
                    }}
                    className={`min-h-9 rounded-full px-3 text-[12px] font-bold active:scale-95 ${
                      nuevoMonto === a.monto
                        ? "bg-[#1E47C8] text-white"
                        : "border border-[#C7D2EC] bg-white text-azul"
                    }`}
                  >
                    {a.etiqueta}
                  </button>
                ))}
              </div>

              {/* 4) QUÉ VA A PAGAR EL CLIENTE. Es lo que el cobrador le dice en voz
                  alta, y hasta ahora tenía que calcularlo de memoria. */}
              <div className="grid grid-cols-3 gap-2 rounded-[11px] bg-white p-2.5">
                <Dato k="Cuota" v={UYU(nuevaCuota)} />
                <Dato k="Cuotas" v={`${cuotasRenovN} ${etiquetaFrec(c.frecuencia)}`} />
                <Dato k="Paga en total" v={UYU(nuevaCuota * cuotasRenovN)} />
              </div>
              <span className="text-[11.5px] leading-[1.4] font-semibold text-gris">
                Empieza a pagar {primerCobro}. Hoy recibe la plata, mañana arranca.
              </span>

              {/* Cambiar las cuotas confunde si no se dice qué hace: NO cambia lo
                  que el cliente paga en total, solo cómo se reparte. */}
              {cuotasEditadas && (
                <span className="rounded-[10px] bg-[#EEF3FF] px-2.5 py-2 text-[11.5px] leading-[1.45] font-bold text-[#1E47C8]">
                  Antes eran {c.totalDias} {etiquetaFrec(c.frecuencia)}. Paga lo mismo en total
                  ({UYU(totalAPagarRenov)}): con {cuotasRenovN} le queda una cuota de{" "}
                  {UYU(nuevaCuota)}.
                </span>
              )}

              {/* 5) EL LÍMITE, SIEMPRE a la vista — no recién cuando ya se pasó. */}
              {!pideAprobacion && techo > sugeridoRenov && (
                <span className="text-[11.5px] leading-[1.4] font-semibold text-gris">
                  Podés darle hasta {UYU(techo)} vos solo. Más que eso lo aprueba la oficina.
                </span>
              )}
              {pideAprobacion && (
                <span className="rounded-[10px] bg-[#FDF3E2] px-2.5 py-2 text-[11.5px] leading-[1.45] font-bold text-[#8A6D1E]">
                  {UYU(nuevoMonto)} pasa los {UYU(techo)} que podés dar solo. Al confirmar se
                  manda el pedido a la oficina y te avisan cuando lo aprueben.
                  <br />
                  <strong>Todavía NO le entregues la plata.</strong>
                </span>
              )}
              {(renovEditado || cuotasEditadas) && (
                <button
                  type="button"
                  onClick={() => {
                    setMontoRenov(String(sugeridoRenov));
                    setCuotasRenov(String(c.totalDias));
                    setConfirmar(false);
                  }}
                  className="self-start text-[11.5px] font-bold text-azul"
                >
                  ← Volver a como estaba ({UYU(sugeridoRenov)} en {c.totalDias})
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-[13px] bg-[#F7F9FD] p-3">
              <span className="text-[11.5px] font-bold text-gris">
                Su último crédito fue de {UYU(c.monto)}
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
                    <Dato k="Cuotas" v={`${cuotasN} días`} />
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
                  ? `${UYU(montoN)} pasa lo que podés dar solo. El máximo para este cliente es ${UYU(techo)} — para más, pedíselo a tu supervisor.`
                  : `Podés darle hasta ${UYU(techo)}.`}
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
              disabled={pendiente || (modo === "venta" && (excede || montoN <= 0 || cuotasN <= 0)) || (modo === "renovar" && nuevoMonto <= 0)}
              onClick={() => (confirmar ? colocar() : setConfirmar(true))}
              className="min-h-11 flex-1 rounded-[13px] bg-[#1FA971] text-[13px] font-extrabold text-white disabled:opacity-50"
            >
              {/* El primer toque YA dice qué va a pasar y con qué número: antes
                  decía solo "Confirmar" y el cobrador confirmaba a ciegas. */}
              {pendiente
                ? "Creando…"
                : confirmar
                  ? modo === "renovar"
                    ? pideAprobacion
                      ? `Sí, pedir ${UYU(nuevoMonto)} a la oficina`
                      : `Sí, entregarle ${UYU(nuevoMonto)}`
                    : `Sí, entregarle ${UYU(montoN)}`
                  : modo === "renovar"
                    ? pideAprobacion
                      ? `Pedir ${UYU(nuevoMonto)} a la oficina`
                      : `Renovar por ${UYU(nuevoMonto)}`
                    : `Dar ${UYU(montoN)}`}
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

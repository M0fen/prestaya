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
import { PedirAyuda } from "@/components/cobrador/PedirAyuda";
import type { FrecuenciaPrestamo } from "@/types/db";
import {
  calcularCuotaCreditoNuevo,
  interesDeBase,
  INTERES_DEFECTO_PCT,
} from "@/lib/creditoNuevo";
import { interesEfectivo, cuotasQueDanJusto } from "@/lib/renovacion";

interface Candidato {
  clienteId: string;
  nombre: string;
  documento: string | null;
  prestamoId?: string;
  /** Desde cuándo corría el crédito que se renueva: lo único que distingue dos
   *  saldados del mismo monto. */
  desde?: string;
  monto: number;
  cuota: number;
  /** Cuota sin redondear: la tasa exacta con la que el servidor va a calcular.
   *  Solo para la cuenta de abajo, nunca para mostrar. */
  cuotaExacta?: number;
  totalDias: number;
  frecuencia: string;
  /** Hasta cuánto puede llegar sin permiso (tope del tramo de SU monto anterior).
   *  Lo calcula el servidor con la misma función que después valida el alta. */
  techo: number;
  /** Tope DURO (solo al renovar): por encima NO lo puede ni la oficina. Sin esto
   *  el botón ofrecía "Pedir $X a la oficina" para montos que el servidor rechaza
   *  de plano — una promesa imposible, con el cliente enfrente. */
  maximo?: number;
  /** Renovar: monto SUGERIDO del crédito nuevo = el mismo que terminó de pagar.
   *  Lo calcula el servidor con la misma función que después valida el alta. */
  montoNuevo?: number;
  /** Renovar: cuota del crédito NUEVO. */
  cuotaNueva?: number;
  /** Supera el tope del sistema: el toque manda el pedido al admin, no lo crea. */
  requiereAprobacion?: boolean;
  /** Deuda viva en sus OTROS créditos activos (0 si no tiene). Se avisa, no bloquea. */
  deudaHermano?: number;
  /** Es su PRIMER crédito (recién censado, o historial roto del import): sale al
   *  20% del negocio, directo, con el CAP como único tope (Carlos, 08-13). */
  primerCredito?: boolean;
  /** El "primer crédito" viene de historial ROTO del import, no de alguien que
   *  nunca tuvo: cambia el subtítulo para no contradecir al aviso de deuda viva. */
  historialRoto?: boolean;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "2026-03-01" → "01/03". Distingue dos créditos saldados del mismo monto. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

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

/** Lo que acaba de pasar, guardado FUERA de la tarjeta. */
interface Hecho {
  clienteId: string;
  nombre: string;
  texto: string;
  como: "creado" | "repetido" | "pedido";
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
  // ⚠️ LA CONFIRMACIÓN VIVE ACÁ, NO ADENTRO DE LA TARJETA.
  //
  // Antes el "Listo ✓ · cuota $1.200" se pintaba dentro de la tarjeta del cliente.
  // Al terminar, la pantalla se refresca: el crédito recién creado ya no está
  // saldado, el cliente sale de la lista de "para renovar" y la tarjeta —con el
  // cartel verde adentro— se DESTRUYE. En su lugar aparece un cartel ámbar que
  // dice "todavía está pagando… dale una NUEVA VENTA".
  //
  // O sea: el cobrador entregaba la plata, miraba para otro lado un segundo, y al
  // volver la pantalla lo invitaba a colocar otra vez, sin ninguna señal de que
  // ya lo había hecho. Es exactamente la duda que dejó a MAICOL RIVERO y a JOSE
  // MONTERO con $28.000 duplicados. Acá arriba sobrevive al refresco.
  const [hecho, setHecho] = useState<Hecho | null>(null);
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

  // El cartel de "ya está hecho", arriba de todo y a prueba de refrescos.
  const confirmacion = hecho ? <Confirmacion h={hecho} /> : null;

  if (candidatos.length === 0 && noElegibles.length === 0) {
    if (hecho) return <div className="flex flex-col gap-3">{confirmacion}</div>;
    return (
      <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] leading-[1.5] font-medium text-gris">
        {modo === "renovar"
          ? "Ninguno de tus clientes terminó de pagar todavía. Cuando alguno complete su crédito, aparece acá para renovarlo de un toque."
          : "No tenés clientes en la ruta todavía. Censá al primero y le podés dar su crédito acá mismo."}
      </p>
    );
  }

  // Se llegó desde la ficha de UNA persona: se le muestra ESA, abierta, y nada más.
  // Hacerle buscar en una lista de 120 nombres a alguien que tiene al cliente
  // enfrente es exactamente lo que hizo que el operador no encontrara la venta.
  if (clienteFoco) {
    return (
      <div className="flex flex-col gap-3">
        {confirmacion}
        {soloFoco && soloFoco.length > 0 ? (
          soloFoco.map((c) => (
            <Tarjeta
              key={c.clienteId + (c.prestamoId ?? "")}
              c={c}
              modo={modo}
              abrirYa
              onHecho={setHecho}
            />
          ))
        ) : hecho ? null : focoBloqueado ? (
          <TarjetaBloqueada c={focoBloqueado} />
        ) : (
          /* ⚠️ Desde el 08-13 el recién censado YA aparece como candidato (su
             primer crédito lo coloca el cobrador directo), así que acá solo cae
             el caso raro: el crédito es de OTRO cobrador, o el cliente quedó
             fuera de la ruta. Se dice cuál es la salida — nunca un callejón. */
          <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-borde bg-white px-4 py-5 text-center">
            <p className="text-[13px] leading-[1.5] font-semibold text-tinta">
              A esta persona no le podés colocar {modo === "renovar" ? "una renovación" : "un crédito"} vos solo.
            </p>
            <p className="text-[12px] leading-[1.5] font-medium text-gris">
              Su crédito puede ser de <strong className="font-bold">otro cobrador</strong> (miralo
              en su cartón), o quedó fuera de tu ruta. Si te corresponde, pedilo acá.
            </p>
            <PedirAyuda
              clienteId={clienteFoco}
              etiqueta="Pedirlo a la oficina"
              textoSugerido="Pido crédito para este cliente. Está en mi ruta y quiere tomar uno."
            />
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
      {confirmacion}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Buscar por nombre o cédula…"
        className="w-full rounded-[13px] border border-borde bg-white px-3.5 py-3 text-[16px] outline-none focus:border-azul"
      />

      {/* ⚠️ Cuánta plata hay que LLEVAR. Ninguna tarjeta cerrada mostraba un peso:
          para saber que hoy tiene que salir con $113.500 encima, el cobrador tenía
          que abrir las 10 una por una y sumar de memoria. Si sale con $40.000, en
          la cuarta casa se queda sin efectivo y le dice al cliente que vuelve. */}
      {candidatos.length > 0 && !q && (() => {
        // El total de "cuánta plata llevar" solo puede sumar montos CONOCIDOS:
        // los primeros créditos no tienen monto hasta que el cobrador lo decide,
        // y contarlos como $0 dejaba el número corto (auditoría 08-14).
        const conMonto = candidatos.filter((c) => !c.primerCredito);
        const primeros = candidatos.length - conMonto.length;
        return (
          <div className="flex items-center justify-between gap-3 rounded-[13px] border border-[#DCE6FB] bg-[#F7F9FF] px-3.5 py-3">
            <span className="text-[12.5px] leading-[1.4] font-bold text-tinta">
              {conMonto.length} {modo === "renovar" ? "para renovar" : "para vender"}
              <span className="font-medium text-gris"> · si los hacés a todos</span>
              {primeros > 0 && (
                <span className="block text-[11px] font-semibold text-gris">
                  + {primeros} primer{primeros === 1 ? "" : "os"} crédito{primeros === 1 ? "" : "s"} (monto a definir)
                </span>
              )}
            </span>
            <span className="flex-shrink-0 text-[16px] font-black tabular-nums text-[#1E47C8]">
              {UYU(conMonto.reduce((t, c) => t + (c.montoNuevo ?? c.monto), 0))}
            </span>
          </div>
        );
      })()}

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
        <Tarjeta key={c.clienteId + (c.prestamoId ?? "")} c={c} modo={modo} onHecho={setHecho} />
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

/** El cartel de "ya está hecho". Vive en la LISTA, no en la tarjeta, así sobrevive
 *  al refresco que borra al cliente de los candidatos.
 *
 *  TRES resultados, TRES colores. Verde = el capital salió. Ámbar = ya estaba hecho
 *  (reintento tras un corte de señal). ROJO = se PIDIÓ a la oficina y NO se creó
 *  nada. El "pedido" se pintaba verde con ✓ igual que el éxito: en la calle, de
 *  reojo, verde + ✓ = hecho, y el cobrador entregaba el efectivo por un crédito
 *  que no existe. */
function Confirmacion({ h }: { h: Hecho }) {
  const tono =
    h.como === "pedido"
      ? { borde: "#F0C0BC", fondo: "#FDEEEC", texto: "#B03A2E" }
      : h.como === "repetido"
        ? { borde: "#F0DCA8", fondo: "#FDF8EC", texto: "#8A6D1E" }
        : { borde: "#BEEBD5", fondo: "#F0FBF5", texto: "#157A50" };
  return (
    <div
      className="flex flex-col gap-1 rounded-[16px] border p-4"
      style={{ borderColor: tono.borde, background: tono.fondo }}
    >
      <span className="text-[14px] font-extrabold" style={{ color: tono.texto }}>
        {h.nombre}
      </span>
      <p className="text-[12.5px] leading-[1.45] font-bold" style={{ color: tono.texto }}>
        {h.texto}
      </p>
      {h.como === "pedido" && (
        <p
          className="mt-1 rounded-[10px] bg-white/70 px-2.5 py-2 text-[13px] leading-[1.4] font-extrabold"
          style={{ color: tono.texto }}
        >
          ⛔ NO le entregues la plata todavía. El crédito NO existe hasta que la oficina apruebe.
        </p>
      )}
      <a
        href={`/cobrador/cliente/${h.clienteId}`}
        className="mt-1.5 min-h-11 self-start rounded-full bg-white px-4 text-[12.5px] font-bold leading-[44px] active:scale-95"
        style={{ color: tono.texto, boxShadow: `inset 0 0 0 1px ${tono.borde}` }}
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
  onHecho,
}: {
  c: Candidato;
  modo: "renovar" | "venta";
  /** Se entró desde la ficha de este cliente: ya está decidido de quién se trata. */
  abrirYa?: boolean;
  /** Avisa a la LISTA que ya se colocó: el cartel se pinta allá arriba, donde el
   *  refresco no se lo lleva puesto. */
  onHecho: (h: Hecho) => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abrirYa);
  const [confirmar, setConfirmar] = useState(false);
  /** Monto y cuotas de la NUEVA VENTA. Arrancan en los del último crédito: lo más
   *  común es repetir, y así el que solo quiere cambiar UNA cosa toca UNA cosa.
   *  Para un PRIMER crédito no hay último: el monto arranca vacío (lo decide el
   *  cobrador mirando al cliente) y las cuotas en 24, el plazo más común. */
  const [monto, setMonto] = useState(c.primerCredito ? "" : String(c.montoNuevo ?? c.monto));
  const [cuotas, setCuotas] = useState(c.primerCredito ? "24" : String(c.totalDias));
  const [msg, setMsg] = useState<string | null>(null);
  /** El servidor frenó un posible duplicado: el próximo toque lo confirma. */
  const [repetirIgual, setRepetirIgual] = useState(false);
  /** Esta tarjeta ya cumplió: se apaga y el cartel lo pinta la lista. */
  const [hechoAca, setHechoAca] = useState(false);
  const [pendiente, start] = useTransition();

  const montoN = Math.round(Number(monto) || 0);
  const cuotasN = Math.round(Number(cuotas) || 0);
  /** Mismo tope de cuotas que el servidor (366): sin espejarlo acá, un dedazo
   *  (400 cuotas) pintaba números normales y el rojo llegaba del servidor con el
   *  cliente enfrente — la promesa que la lista no puede romper (auditoría 08-14). */
  const cuotasPasan = cuotasN > 366;
  const techo = c.techo;
  /** Pasa lo que el cobrador puede solo → hay que pedirlo (si hay a quién). */
  const excede = montoN > techo;
  /** Pasa el tope DURO: no lo puede ni la oficina. Solo existe al renovar; en la
   *  venta nueva el techo del tramo YA es el máximo (el CAP acota el capital
   *  nuevo), así que el máximo coincide con el techo. */
  const pasaMaximo = montoN > (c.maximo ?? techo);
  /** ¿Este toque manda un pedido a la oficina en vez de crear el crédito?
   *  En VENTA, cualquier monto sobre el techo (y bajo el CAP) genera solicitud —
   *  también para el cliente sin crédito activo (0139): antes ese caso era un
   *  "dejale el pedido a tu supervisor" que viajaba por fuera de la app. El
   *  PRIMER crédito nunca pide: su techo ES el CAP. */
  const aOficina = modo === "renovar" ? !!c.requiereAprobacion : excede && !pasaMaximo;
  /** Lo que se le entrega al RENOVAR: el mismo monto del crédito que terminó. */
  const sugeridoRenov = c.montoNuevo ?? c.monto;

  // Cuota estimada de una VENTA nueva. Se calcula con la MISMA función pura que
  // usa el servidor, arrastrando la tasa del último crédito del cliente: el que
  // vuelve no estrena condiciones. Es una estimación para mostrar (el servidor
  // recalcula y manda); sin ella el cobrador no podía decirle al cliente cuánto
  // iba a pagar por día hasta después de crear el crédito.
  const cuotaVenta = useMemo(() => {
    if (!(montoN > 0) || !(cuotasN > 0)) return 0;
    // ⚠️ Con la cuota EXACTA (sin redondear) cuando viene: es la que usa el
    // servidor para arrastrar la tasa. Con la redondeada, el número que el
    // cobrador le decía en voz alta al cliente salía hasta $1 distinto del que
    // quedaba en el cartón (53 créditos heredados tienen cuota fraccionaria).
    // PRIMER crédito: no hay base → 20% del negocio, igual que el servidor.
    const base = c.primerCredito
      ? null
      : { monto: c.monto, cuota: c.cuotaExacta ?? c.cuota, totalDias: c.totalDias };
    return calcularCuotaCreditoNuevo(base, montoN, cuotasN, interesDeBase(base) ?? INTERES_DEFECTO_PCT);
  }, [montoN, cuotasN, c.monto, c.cuota, c.cuotaExacta, c.totalDias, c.primerCredito]);

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
            ? await renovarDesdeCalle({ clienteId: c.clienteId, prestamoId: c.prestamoId!, repetirIgual })
            : c.prestamoId
              ? await renovarDesdeCalle({
                  clienteId: c.clienteId,
                  prestamoId: c.prestamoId,
                  monto: montoN,
                  cuotas: cuotasN,
                  repetirIgual,
                })
              : await nuevaVentaDesdeCalle({
                  clienteId: c.clienteId,
                  monto: montoN,
                  totalDias: cuotasN,
                  frecuencia: c.frecuencia as FrecuenciaPrestamo,
                  repetirIgual,
                });
        if (r.ok) {
          // Puede haber quedado PEDIDO a la oficina (supera el tope) en vez de
          // creado: el mensaje lo dice, para que el cobrador no le prometa al
          // cliente un crédito que todavía tiene que aprobar el admin.
          // ⚠️ "Ya estaba hecho" NO es lo mismo que "lo acabo de crear". El
          // reintento tras un corte de señal devuelve `repetido`, y si se muestra
          // el mismo verde el cobrador cree que recién colocó el capital y le
          // entrega la plata al cliente DE NUEVO. Se dice distinto, explícito.
          const monto = modo === "renovar" ? sugeridoRenov : montoN;
          onHecho({
            clienteId: c.clienteId,
            nombre: c.nombre,
            como: "solicitado" in r ? "pedido" : r.repetido ? "repetido" : "creado",
            texto:
              "solicitado" in r
                ? r.mensaje
                : r.repetido
                  ? "Ya estaba renovado ✓ — no se creó otro. Si ya le entregaste la plata, no se la des de nuevo."
                  : `Le entregaste ${UYU(monto)}${r.cuota ? ` · cuota ${UYU(r.cuota)}` : ""} ✓`,
          });
          setHechoAca(true);
          router.refresh();
        } else {
          setMsg(r.error);
          setConfirmar(false);
          // Si lo frenó el candado anti-duplicado, el PRÓXIMO toque confirma que
          // de verdad son dos créditos. No se arma solo: lo tiene que decidir él.
          if ((r as { duplicado?: boolean }).duplicado) setRepetirIgual(true);
        }
      } catch {
        // Red caída a mitad de la colocación: aviso inline (antes reventaba al
        // error boundary y el cobrador no sabía si el crédito se creó). El
        // reintento es seguro: la idempotencia por op_id no duplica el capital.
        setMsg("Sin señal: no sabemos si entró. Con conexión, tocá de nuevo — no se duplica.");
        setConfirmar(false);
      }
    });

  // Ya se colocó: la tarjeta se apaga y el cartel lo pinta la LISTA (Confirmacion),
  // que es lo único que sobrevive al refresco.
  if (hechoAca) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-tinta">{c.nombre}</span>
          <span className="text-[11.5px] font-semibold text-gris tabular-nums">
            {modo === "renovar"
              ? `Terminó de pagar ✓ · ${UYU(sugeridoRenov)}${c.desde ? ` · desde ${diaMes(c.desde)}` : ""}`
              : c.primerCredito
                ? c.historialRoto
                  ? "Sin historial usable · sale como primer crédito"
                  : "Nunca tuvo crédito · primer crédito"
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
              {/* ⚠️ EL INTERÉS, SIEMPRE A LA VISTA. Sin este número nadie podía notar
                  que un crédito estaba naciendo al 0% —o peor, en negativo— con la
                  tasa heredada de Disapp: 192 créditos activos por $72.113.554 están
                  en 0%, y renovarlos arrastraba ese 0% al crédito nuevo. */}
              <Interes
                monto={sugeridoRenov}
                cuota={c.cuotaNueva ?? c.cuota}
                dias={c.totalDias}
              />
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
                {c.primerCredito
                  ? "Es su PRIMER crédito: sale al 20% del negocio."
                  : c.prestamoId
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
              {montoN > 0 && cuotasN > 0 && !excede && !cuotasPasan && (
                <>
                  <div className="grid grid-cols-3 gap-2 rounded-[11px] bg-white p-2.5">
                    <Dato k="Cuota" v={UYU(cuotaVenta)} />
                    <Dato k="Cuotas" v={`${cuotasN} ${etiquetaFrec(c.frecuencia)}`} />
                    <Dato k="Paga en total" v={UYU(cuotaVenta * cuotasN)} />
                  </div>
                  {/* El interés REAL del crédito que se está por crear, con el
                      redondeo de la cuota ya adentro. Es el número que importa. */}
                  <Interes monto={montoN} cuota={cuotaVenta} dias={cuotasN} sugerirCuotas />
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
                {/* Tres mensajes distintos porque son tres finales distintos: se
                    crea solo · lo pide a la oficina · no lo puede NADIE. Desde la
                    0139 el sobre-techo SIEMPRE tiene puerta: genera una solicitud
                    que aprueba tu supervisor o el admin (antes el cliente sin
                    crédito activo terminaba en un aviso que viajaba por fuera). */}
                {cuotasN > 0 && cuotasPasan
                  ? "El máximo son 366 cuotas. Revisá la cantidad."
                  : pasaMaximo
                    ? `${UYU(montoN)} no se puede: para este cliente el máximo es ${UYU(c.maximo ?? techo)}, ni la oficina puede subirlo. Revisá el monto.`
                    : excede
                      ? `${UYU(montoN)} pasa los ${UYU(techo)} que podés dar solo. Al confirmar se manda el pedido a la oficina — todavía NO le entregues la plata.`
                      : c.primerCredito
                        ? `Podés darle hasta ${UYU(techo)} vos solo (tope del sistema).`
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
              disabled={
                pendiente ||
                (modo === "venta" && (pasaMaximo || cuotasPasan || montoN <= 0 || cuotasN <= 0))
              }
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

/**
 * EL INTERÉS DEL CRÉDITO, siempre visible. Tres estados y tres colores, porque son
 * tres cosas distintas para el bolsillo del negocio:
 *  · ROJO   → el crédito devuelve MENOS de lo que se presta. No puede salir así.
 *  · ÁMBAR  → quedó por debajo del 20% del negocio (o el redondeo lo corrió).
 *  · VERDE  → está en el 20% (o arriba).
 * Cuando el redondeo de la cuota deja el total corrido, se ofrece la cantidad de
 * cuotas más cercana que da JUSTO — que es la salida real al problema de los $2.
 */
function Interes({
  monto,
  cuota,
  dias,
  sugerirCuotas = false,
}: {
  monto: number;
  cuota: number;
  dias: number;
  sugerirCuotas?: boolean;
}) {
  if (!(monto > 0) || !(cuota > 0) || !(dias > 0)) return null;
  const pct = interesEfectivo(monto, cuota, dias);
  const total = cuota * dias;
  // La GANANCIA REAL en pesos manda el color, no el % redondeado: un crédito de
  // $94.500 que gana $25 tiene pct 0,0% (redondeado) pero NO "devuelve menos de lo
  // que entregás" — con el % solo, el cartel rojo decía eso y al lado "gana $25",
  // dos frases que se contradicen en la misma tarjeta.
  const gana = total - monto;
  const objetivo = Math.round(monto * (1 + INTERES_DEFECTO_PCT / 100));
  const dif = total - objetivo;
  const justo = sugerirCuotas && dif !== 0 ? cuotasQueDanJusto(monto, INTERES_DEFECTO_PCT, dias) : null;
  const tono =
    gana <= 0
      ? { bg: "#FBE4E2", fg: "#C0392B" }
      : pct < INTERES_DEFECTO_PCT - 0.05
        ? { bg: "#FDF3E2", fg: "#B9770E" }
        : { bg: "#E4F5EC", fg: "#157A50" };
  return (
    <div
      className="flex flex-col gap-1 rounded-[11px] px-3 py-2"
      style={{ background: tono.bg }}
    >
      <span className="text-[12px] font-extrabold tabular-nums" style={{ color: tono.fg }}>
        {gana <= 0 ? "⛔ " : ""}Interés {pct.toFixed(1).replace(".", ",")}%
        <span className="font-semibold"> · gana {UYU(gana)}</span>
      </span>
      {gana <= 0 && (
        <span className="text-[11.5px] leading-[1.4] font-bold" style={{ color: tono.fg }}>
          Este crédito {gana < 0 ? "devuelve menos de lo que entregás" : "no gana nada"}. Avisá a
          la oficina antes de darlo.
        </span>
      )}
      {justo && (
        <span className="text-[11px] leading-[1.4] font-semibold" style={{ color: tono.fg }}>
          Con <strong>{justo} cuotas</strong> queda justo en {INTERES_DEFECTO_PCT}% ({UYU(objetivo)}).
          Así como está{dif < 0 ? ` se pierden ${UYU(-dif)}` : ` cobra ${UYU(dif)} de más`}.
        </span>
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

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
import { suscribir, pendientes, hidratar, quitar } from "@/lib/cobrador/colaOffline";
import { bloqueoCierrePorCola } from "@/lib/cobrador/bloqueoCierre";
import { PedirAyuda } from "@/components/cobrador/PedirAyuda";
import type { RendicionDia } from "@/lib/data/rendicion";

const TONO: Record<EstadoRendicion, { bg: string; fg: string }> = {
  cuadra: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  faltante: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  sobrante: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
};

export function CerrarJornada({
  recaudado,
  cobrosCantidad,
  gastosHoy = 0,
  gastosPendientes = 0,
  base = 0,
  baseOrigen = "sin_base",
  colocado = 0,
  creditosColocados = 0,
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
   *  cobrado → esperado = base + recaudado − gastos − colocado. 0 si no tiene. */
  base?: number;
  /** De dónde salió la base: arrastre de su caja de ayer, cargada, o nada. */
  baseOrigen?: "cargada" | "arrastre" | "sin_base";
  /** Capital que ENTREGÓ hoy al renovar/vender: ya no lo tiene, así que baja lo
   *  que se le pide rendir. Sin esto la app le marcaba un faltante inventado. */
  colocado?: number;
  creditosColocados?: number;
  yaRendida: RendicionDia | null;
  disponible: boolean;
}) {
  const router = useRouter();
  // Prellena los gastos con lo que el cobrador ya cargó hoy (puede ajustarlo).
  const [gastos, setGastos] = useState(gastosHoy > 0 ? String(gastosHoy) : "");
  // ⚠️ MODELO NUEVO (regla de Carlos 16-08: "la caja final aparece TAL CUAL como
  // caja inicial del otro día"). Antes el prefill era "entrego TODO" (caja final
  // = 0) y si el cobrador se guardaba plata el acta lo marcaba FALTANTE — el
  // arrastre existía en código pero nacía muerto. Ahora hay dos números:
  //   · "Me quedo para mañana" (retenido): por defecto la BASE de hoy — mañana
  //     amanece como su caja inicial, sin que nadie la cargue a mano;
  //   · "Efectivo que entrego": lo demás (cobrado − gastos − colocado).
  // Cuadra cuando entregado + retenido = esperado. Los dos son editables.
  const esperadoInicial = Math.max(0, base + recaudado - gastosHoy - colocado);
  const [retenido, setRetenido] = useState(String(Math.min(base, esperadoInicial)));
  const [entregado, setEntregado] = useState(String(Math.max(0, esperadoInicial - Math.min(base, esperadoInicial))));
  // ¿El cobrador tocó los campos a mano? Si NO, el prefijado se re-sincroniza cuando
  // sube el `recaudado` del servidor (al drenar la cola, `router.refresh` sube el
  // prop SIN desmontar este componente). Sin esto, `entregado` quedaba en el valor
  // viejo y el cierre marcaba un FALTANTE FANTASMA justo al terminar de sincronizar.
  const [editado, setEditado] = useState(false);
  /** "Efectivo que entrego" tocado A MANO: entonces mover "Me quedo" no lo re-deriva. */
  const [entregadoAMano, setEntregadoAMano] = useState(false);
  const [notas, setNotas] = useState("");
  const [reintentando, setReintentando] = useState(false);
  /** Cómo salió el último empujón manual de la cola. Sin esto el botón decía
   *  "Intentando…" cuatro segundos y volvía, sin una palabra de resultado. */
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  /** Cobro atascado que espera el 2º toque para descartarse (nunca de un toque:
   *  descartar borra el registro de plata que el cobrador ya tiene encima). */
  const [porDescartar, setPorDescartar] = useState<string | null>(null);
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
    const esp = Math.max(0, base + recaudado - gastosHoy - colocado);
    const ret = Math.min(base, esp);
    setRetenido(String(ret));
    setEntregado(String(Math.max(0, esp - ret)));
  }, [recaudado, gastosHoy, editado, base, colocado]);

  if (!disponible) return null; // se habilita al correr 0013

  // Ya cerró: resumen de solo lectura.
  if (yaRendida) {
    const t = TONO[yaRendida.estado];
    // El colocado CONGELADO al cerrar (0136). Si la migración no corrió, se cae al
    // vivo. Sin esto, renovar a alguien DESPUÉS de rendir movía los números de un
    // acta ya firmada.
    const colocadoSellado = yaRendida.colocado ?? colocado;
    return (
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] font-extrabold text-tinta">
            {yaRendida.estado === "cuadra" ? "¡Bien ahí! Jornada cerrada 🎉" : "Jornada cerrada ✓"}
          </span>
          <span className="rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {ETIQUETA_ESTADO[yaRendida.estado]}
          </span>
        </div>
        {yaRendida.estado === "cuadra" && (
          <p className="mb-2 text-[12.5px] font-medium text-verde-osc">
            Cuadraste perfecto. Gracias por tu laburo de hoy 💚
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          {yaRendida.base > 0 && <Fila k="Base recibida" v={UYU(yaRendida.base)} />}
          <Fila k="Recaudado" v={UYU(yaRendida.recaudado)} />
          <Fila k="Gastos de ruta" v={UYU(yaRendida.gastos)} />
          {/* El CONGELADO de la rendición (0136), no el vivo: si el cobrador
              renovaba a alguien DESPUÉS de cerrar, el acta ya firmada cambiaba
              sola y los tres números de esta misma tarjeta se contradecían. */}
          {colocadoSellado > 0 && (
            <Fila k="Capital entregado en la calle" v={`− ${UYU(colocadoSellado)}`} />
          )}
          <Fila
            k="A entregar"
            v={UYU(
              Math.max(
                0,
                yaRendida.base + yaRendida.recaudado - yaRendida.gastos - colocadoSellado,
              ),
            )}
          />
          <Fila k="Entregado" v={UYU(yaRendida.entregado)} />
        </div>
        {yaRendida.diferencia !== 0 && (
          <div className="mt-2 rounded-[12px] px-3 py-2 text-[12.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
            {yaRendida.diferencia < 0 ? "Faltante" : "Sobrante"} de {UYU(Math.abs(yaRendida.diferencia))}
          </div>
        )}
        {/* El cierre es irreversible por diseño (es el sello de la custodia),
            pero antes acá no había NADA que tocar: si tecleó 15000 en vez de
            1500, le quedaba un faltante de $13.500 a su nombre y ni un teléfono
            al que avisar. No hace falta poder editarlo — hace falta que exista
            una salida y que quede constancia de que él lo reportó. */}
        <p className="mt-3 border-t border-linea pt-2.5 text-[11.5px] leading-[1.45] font-medium text-gris">
          ¿Cargaste algo mal? El cierre no se edita, pero avisá y la oficina lo corrige.{" "}
          <a href="/cobrador/chat" className="font-bold text-azul underline">
            Avisar a mi supervisor →
          </a>
        </p>
      </section>
    );
  }

  const gastosN = Math.max(0, Math.round(Number(gastos) || 0));
  const entregadoN = Math.max(0, Math.round(Number(entregado) || 0));
  // El MISMO clamp que aplica el servidor (declarar de más no fabrica sobrante ni
  // base): el preview dice lo que el acta va a decir, no otra cosa (auditoría 16-08).
  const esperadoBruto = Math.max(0, base + recaudado - gastosN - colocado);
  const retenidoN = Math.min(Math.max(0, Math.round(Number(retenido) || 0)), Math.max(0, esperadoBruto - entregadoN));
  const retenidoDeMas = Math.max(0, Math.round(Number(retenido) || 0)) > retenidoN;
  const { esperado, diferencia, estado, aFavor } = calcularRendicion(recaudado, gastosN, entregadoN, base, colocado, retenidoN);
  const t = TONO[estado];

  // La regla del bloqueo vive en lib/cobrador/bloqueoCierre (pura y testeada):
  // sincronizando bloquea (faltante fantasma), atascado no bloquea pero se
  // lista — cobros Y visitas "no pagó", para que la franja naranja tenga salida.
  const {
    bloquea: hayColaPendiente,
    cobrosPend,
    atascados: cobrosAtascados,
    montoPend,
    clienteDeLaCola,
  } = bloqueoCierrePorCola(ops);

  const cerrar = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cerrarJornada({ gastos: gastosN, entregado: entregadoN, retenido: retenidoN, notas });
        if (res.ok) {
          setConfirmar(false);
          router.refresh();
        } else {
          setError(res.error);
          setConfirmar(false);
        }
      } catch {
        // Red caída al cerrar: aviso inline (antes error boundary). Reintentar es
        // seguro: la rendición es unique por (cobrador, fecha) — no se duplica.
        setError("Sin señal: el cierre no llegó. Probá de nuevo con conexión.");
        setConfirmar(false);
      }
    });
  };

  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <span className="text-[14px] font-extrabold text-tinta">Cerrar jornada</span>

      {/* La línea de la base se muestra SIEMPRE, también en $0. Antes se ocultaba
          cuando era 0 y el cobrador no tenía forma de saber si su base estaba
          cargada: si el supervisor le dio $5.000 en la mano y no los registró,
          la app le pedía $5.000 menos de los que tenía en el bolsillo y salía un
          sobrante fantasma (o se quedaba la base sin que nadie lo anotara). Hoy
          es el primer día que se usa esta pantalla: `aperturas_caja` está vacía. */}
      {base > 0 ? (
        <div className="mt-2 flex items-end justify-between rounded-[12px] bg-azul-suave px-3 py-2.5">
          <span className="text-[12px] font-semibold text-azul">
            {baseOrigen === "arrastre" ? "Base del día · tu caja final de ayer" : "Base del día (tu caja de arranque)"}
          </span>
          <span className="text-[16px] font-black tabular-nums text-azul">{UYU(base)}</span>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-0.5 rounded-[12px] bg-ambar-suave px-3 py-2.5">
          <span className="text-[12px] font-bold text-ambar-osc">Base de arranque: $0</span>
          <span className="text-[11px] leading-[1.45] font-medium text-ambar-osc">
            Si tu supervisor te dio efectivo para arrancar el día, avisale que lo cargue
            <b> antes</b> de que cierres: si no, te va a figurar como plata de más.
          </span>
        </div>
      )}

      <div className="mt-2 flex items-end justify-between rounded-[12px] bg-app px-3 py-2.5">
        <span className="text-[12px] font-semibold text-gris">Recaudado hoy</span>
        <span className="text-[18px] font-black tabular-nums text-verde">
          {UYU(recaudado)}
          <span className="ml-1 text-[11px] font-semibold text-gris">· {cobrosCantidad} cobro{cobrosCantidad === 1 ? "" : "s"}</span>
        </span>
      </div>

      {/* Capital que YA entregó en la calle: esa plata no la tiene, así que no se
          le pide. Faltaba y le inventaba un faltante del tamaño de lo que colocó. */}
      {colocado > 0 && (
        <div className="mt-2 flex items-end justify-between rounded-[12px] bg-violeta-suave px-3 py-2.5">
          <span className="text-[12px] font-semibold text-violeta-osc">
            Capital que entregaste hoy
            <span className="ml-1 text-[11px] font-medium">
              · {creditosColocados} crédito{creditosColocados === 1 ? "" : "s"}
            </span>
          </span>
          <span className="text-[16px] font-black tabular-nums text-violeta-osc">− {UYU(colocado)}</span>
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Campo label="Gastos de ruta">
          <input
            inputMode="numeric"
            value={gastos}
            onChange={(e) => { setEditado(true); setGastos(e.target.value.replace(/[^\d]/g, "")); }}
            placeholder="0"
            className="min-h-11 w-full rounded-[12px] border border-campo px-3 py-3 text-[16px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
        <Campo label="Efectivo que entrego">
          <input
            inputMode="numeric"
            value={entregado}
            onChange={(e) => { setEditado(true); setEntregadoAMano(true); setEntregado(e.target.value.replace(/[^\d]/g, "")); }}
            placeholder="0"
            className="min-h-11 w-full rounded-[12px] border border-campo px-3 py-3 text-[16px] tabular-nums outline-none focus:border-azul"
          />
        </Campo>
      </div>
      {/* Lo que se QUEDA para mañana = su caja inicial de mañana (regla 16-08).
          Editable: si entrega todo, pone 0 y mañana arranca de cero. */}
      <div className="mt-2 flex flex-col gap-1 rounded-[12px] bg-verde-suave px-3 py-2.5">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-bold text-verde-osc">Me quedo para mañana (mi caja inicial)</span>
          <input
            inputMode="numeric"
            value={retenido}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, "");
              setEditado(true);
              setRetenido(v);
              // "Me quedo" y "entrego" son las dos mitades del mismo esperado: al
              // mover una, la otra se re-deriva (si no la tocó a mano) — así los
              // dos números siempre suman lo que el preview muestra.
              if (!entregadoAMano) setEntregado(String(Math.max(0, esperadoBruto - (Math.round(Number(v)) || 0))));
            }}
            placeholder="0"
            className="min-h-11 w-[120px] rounded-[12px] border border-campo bg-tarjeta px-3 py-2 text-right text-[16px] font-extrabold tabular-nums outline-none focus:border-azul"
          />
        </label>
        <span className="text-[11px] leading-[1.45] font-medium text-verde-osc">
          Mañana amanece como tu base, sin que nadie la cargue. Entregá el resto.
        </span>
        {retenidoDeMas && (
          <span className="text-[11px] leading-[1.45] font-bold text-ambar-osc">
            Solo podés quedarte hasta {UYU(retenidoN)} (lo que tenés después de entregar {UYU(entregadoN)}): el acta va a tomar ese número.
          </span>
        )}
      </div>
      {gastosHoy > 0 && (
        <p className="mt-1.5 px-1 text-[11px] font-medium text-tenue">
          Incluye {UYU(gastosHoy)} de gastos que cargaste hoy. Podés ajustarlo.
        </p>
      )}

      {/* Gastos pedidos pero SIN aprobar: no están en el "esperado". Si el cobrador
          ya gastó esa plata, sin este aviso le saldría un faltante fantasma. Se le
          ofrece SUMARLOS (decisión suya), nunca se restan solos (control anti-fuga). */}
      {gastosPendientes > 0 && (
        <div className="mt-2 flex flex-col items-start gap-1.5 rounded-[12px] border border-campo bg-suave px-3 py-2.5">
          <span className="text-[12px] font-bold text-gris">
            Tenés {UYU(gastosPendientes)} en gastos pendientes de aprobación.
          </span>
          <span className="text-[11.5px] font-medium text-tenue">
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
              if (!editado) {
                const esp = Math.max(0, base + recaudado - nuevoGastos - colocado);
                const ret = Math.min(base, esp);
                setRetenido(String(ret));
                setEntregado(String(Math.max(0, esp - ret)));
              }
              setEditado(true);
              setGastos(String(nuevoGastos));
            }}
            className="rounded-full border border-campo bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-azul active:scale-95"
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
        <span className="rounded-full bg-tarjeta/70 px-2.5 py-1 text-[12px] font-black" style={{ color: t.fg }}>
          {estado === "cuadra" ? "Cuadra ✓" : `${estado === "faltante" ? "Falta" : "Sobra"} ${UYU(Math.abs(diferencia))}`}
        </span>
      </div>

      {/* ⚠️ PUSO PLATA DE MÁS. Cuando el capital colocado se pasa de lo que tenía
          encima (base + cobrado − gastos), el "Debería entregar" se topa en $0 y la
          pantalla decía "Cuadra ✓" a secas: la plata que el cobrador puso de su
          bolsillo no aparecía en ningún lado y no tenía con qué reclamarla al día
          siguiente. Casos reales del piloto: Víctor Moralez $29.020 el 08-07 y
          $18.260 el 08-08, Edward Muñoz $16.000, Anyela Quiñonez $12.800.
          El número ya se calculaba (`aFavorDelCobrador`) y no lo leía nadie. */}
      {aFavor > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-[12px] border border-verde-suave bg-verde-suave px-3 py-2.5">
          <span className="text-[13px] font-extrabold text-verde-osc">
            💚 La oficina te debe {UYU(aFavor)}
          </span>
          <span className="text-[11.5px] leading-[1.45] font-medium text-verde-osc">
            Colocaste {UYU(colocado)} y hoy no te alcanzaba con lo que tenías: esa diferencia la
            pusiste vos. Queda anotada en el cierre — mostrásela a tu supervisor para que te la
            devuelva.
          </span>
        </div>
      )}

      <input
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        maxLength={300}
        placeholder="Nota (opcional): motivo del faltante, etc."
        className="mt-2.5 w-full rounded-[12px] border border-campo px-3 py-2 text-[16px] outline-none focus:border-azul"
      />

      {error && <p className="mt-2 text-[12px] font-semibold text-rojo-osc">{error}</p>}

      {/* Anti-faltante-fantasma: cobros sin sincronizar todavía no están en el
          "recaudado" del servidor. Avisar y bloquear el cierre hasta que suban. */}
      {hayColaPendiente && (
        <div className="mt-3 flex flex-col gap-1 rounded-[12px] border border-ambar-suave bg-ambar-suave px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ambar-osc">
            ⏳ Tenés {cobrosPend.length} cobro{cobrosPend.length === 1 ? "" : "s"} sin subir
            {montoPend > 0 ? ` (${UYU(montoPend)})` : ""}
          </span>
          <span className="text-[11.5px] leading-[1.45] font-medium text-ambar-osc">
            El recaudado todavía no los incluye. Suben solos cuando tengas señal — si estás en una
            zona sin datos, movete unos metros y esperá; el botón de cerrar se habilita solo.
          </span>
          {/* ⚠️ Este botón era DECORATIVO. Despachaba un evento `online` falso, que
              con el teléfono ya "conectado" (barras llenas, datos que no pasan) no
              disparaba nada — y encima, tocado sin señal, dejaba al sincronizador
              creyendo que había conexión y la cola dejaba de subir sola. Ahora
              llama al envío de verdad (`py:sync`) y DICE CÓMO SALIÓ: cuatro
              segundos de "Intentando…" sin ninguna respuesta es lo que hace que el
              cobrador deje de confiar en la app justo cuando más la necesita. */}
          <button
            type="button"
            onClick={() => {
              setReintentando(true);
              setResultadoSync(null);
              const antes = cobrosPend.length;
              if (typeof navigator !== "undefined" && !navigator.onLine) {
                setReintentando(false);
                setResultadoSync("Tu teléfono está sin datos. Movete unos metros y probá otra vez.");
                return;
              }
              window.dispatchEvent(new Event("py:sync"));
              // Se mira la cola DESPUÉS: es la única verdad sobre si subieron.
              setTimeout(() => {
                setReintentando(false);
                const quedan = bloqueoCierrePorCola(pendientes()).cobrosPend.length;
                const subieron = Math.max(0, antes - quedan);
                setResultadoSync(
                  quedan === 0
                    ? `Subieron ${subieron} ✓ Ya podés cerrar.`
                    : subieron > 0
                      ? `Subieron ${subieron}, quedan ${quedan}. Probá de nuevo en un rato.`
                      : "Todavía no suben: hay señal pero el servidor no contesta. Se siguen reintentando solos.",
                );
              }, 4000);
            }}
            disabled={reintentando}
            className="mt-1 min-h-11 self-start rounded-full bg-[#9A6A0E] px-4 text-[12.5px] font-bold text-white disabled:opacity-60"
          >
            {reintentando ? "Intentando…" : "Intentar subirlos ahora"}
          </button>
          {resultadoSync && (
            <span className="text-[11.5px] leading-[1.45] font-bold text-ambar-osc">{resultadoSync}</span>
          )}
          {/* Si después de intentar sigue trabado, hay salida: que quede constancia
              de que terminó la ruta con la plata encima y la app no lo dejó cerrar. */}
          {resultadoSync && !resultadoSync.includes("✓") && clienteDeLaCola && (
            <PedirAyuda
              clienteId={clienteDeLaCola}
              etiqueta="Avisar que no puedo cerrar"
              textoSugerido={`Terminé la ruta y tengo ${UYU(montoPend)} encima que la app no me deja subir (${cobrosPend.length} cobro${cobrosPend.length === 1 ? "" : "s"}). No pude cerrar la jornada.`}
              tono="alerta"
            />
          )}
        </div>
      )}

      {/* Cobros ATASCADOS: no suben (el crédito se cerró/reasignó). No bloquean el
          cierre; el cobrador los descarta (y si el cobro fue real, lo re-registra). */}
      {cobrosAtascados.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-rojo-suave bg-rojo-suave px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-rojo-osc">
            ⚠️ {cobrosAtascados.length} registro{cobrosAtascados.length === 1 ? "" : "s"} no se pudo subir
          </span>
          <span className="text-[11.5px] font-medium text-rojo-osc">
            Abajo está el motivo de cada uno, con lo que dice la oficina.{" "}
            <strong className="font-bold">Si ya recibiste esa plata, no la descartes sin avisar</strong> —
            descartar solo borra el intento de registro, no la plata que tenés encima.
          </span>
          {cobrosAtascados.map((o) => (
            <div key={o.id} className="flex flex-col gap-1.5 border-t border-rojo-suave pt-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 line-clamp-2 break-words leading-[1.2] text-[12px] font-semibold text-tinta">
                  {o.clienteNombre} ·{" "}
                  {o.tipo === "no_pago" ? "no pagó" : o.monto != null ? UYU(o.monto) : "cuota"}
                </span>
                {/* ⚠️ DOS TOQUES. Era un botón único, sin confirmación y sin rastro:
                    un toque y el cobro desaparecía del libro. El cobrador cerraba el
                    día con un sobrante que no sabía explicar. */}
                <button
                  type="button"
                  onClick={() => (porDescartar === o.id ? quitar(o.id) : setPorDescartar(o.id))}
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold active:scale-95 ${
                    porDescartar === o.id
                      ? "bg-[#C0392B] text-white"
                      : "border border-rojo-suave text-rojo-osc"
                  }`}
                >
                  {porDescartar === o.id ? "Sí, descartar" : "Descartar"}
                </button>
              </div>
              {/* El mensaje del SERVIDOR, textual: dice qué pasó y qué hacer con la
                  plata. Antes se descartaba y el cobrador leía un genérico. */}
              {o.motivoFallo && (
                <span className="rounded-[12px] bg-tarjeta/70 px-2.5 py-1.5 text-[11.5px] leading-[1.4] font-semibold text-rojo-osc">
                  {o.motivoFallo}
                </span>
              )}
              {/* Un "no pagó" atascado no es plata: no hace falta ofrecer el aviso
                  ni asustar con "tengo la plata conmigo". Se descarta y listo. */}
              {o.tipo === "pago" && (
                <PedirAyuda
                  clienteId={o.clienteId}
                  etiqueta="Avisar a la oficina"
                  textoSugerido={`No pude registrar un cobro de ${o.monto != null ? UYU(o.monto) : "una cuota"} de ${o.clienteNombre}. ${o.motivoFallo ?? "La app no lo dejó subir."} Tengo la plata conmigo.`}
                  tono="alerta"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!confirmar ? (
        <button
          type="button"
          onClick={() => setConfirmar(true)}
          disabled={hayColaPendiente}
          className="mt-3 w-full btn-primario py-3 text-[15px] font-extrabold disabled:opacity-50"
        >
          {hayColaPendiente ? "Esperá a que suban los cobros…" : "Cerrar jornada"}
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {/* Cierre con $0 recaudado: casi siempre es un error de DÍA (ej. abrir la
              app 00:10 para "cerrar ayer" — ya es el día nuevo y la rendición de ayer
              no se puede crear acá). Sin este freno, esa rendición en $0 bloqueaba el
              día nuevo (unique cobrador+fecha) y todo lo que cobrara después quedaba
              post-cierre. Se avisa fuerte antes de confirmar. */}
          {recaudado === 0 && cobrosCantidad === 0 && (
            <p className="rounded-[12px] border border-ambar-suave bg-ambar-suave px-3 py-2 text-center text-[12px] font-bold text-ambar-osc">
              ⚠️ Vas a cerrar con $0 recaudado. Si querías cerrar la jornada de AYER,
              ya cambió el día: entregale el efectivo al supervisor y no cierres esta.
            </p>
          )}
          {/* GASTOS SIN RESPALDO: el servidor recorta los gastos declarados a los
              que tienen solicitud aprobada. Antes eso pasaba en silencio DESPUÉS
              de confirmar: en pantalla decía "Cuadra ✓" y al recargar aparecía un
              faltante por el monto recortado, sin una palabra de por qué. El
              cobrador iba a pensar que el sistema le comió la plata. */}
          {gastosN > gastosPendientes + gastosHoy && (
            <p className="rounded-[12px] border border-ambar-suave bg-ambar-suave px-3 py-2 text-[12px] leading-[1.45] font-bold text-ambar-osc">
              ⚠️ De los {UYU(gastosN)} de gastos, solo {UYU(gastosHoy + gastosPendientes)} están
              cargados como gasto de ruta. La diferencia te va a figurar como faltante: cargá el
              gasto primero y volvé.
            </p>
          )}
          {/* Un descuadre sin explicación es una discusión con el supervisor
              mañana. Escrita en el momento, se resuelve sola. */}
          {diferencia !== 0 && (
            <div className="flex flex-col gap-1.5 rounded-[12px] border border-rojo-suave bg-rojo-suave px-3 py-2.5">
              <span className="text-[12px] font-bold text-rojo-osc">
                {diferencia < 0
                  ? `Te falta ${UYU(Math.abs(diferencia))}. ¿Contaste de nuevo?`
                  : `Te sobra ${UYU(diferencia)}. ¿Contaste de nuevo?`}
              </span>
              <input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Contá en una línea qué pasó (obligatorio)"
                aria-label="Motivo de la diferencia"
                className="min-h-11 rounded-[12px] border border-campo bg-tarjeta px-3 text-[16px] text-tinta"
              />
            </div>
          )}
          <p className="text-center text-[12.5px] font-semibold text-gris">
            Vas a rendir {UYU(entregadoN)}. El cierre no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmar(false)}
              disabled={pendiente}
              className="flex-1 rounded-[12px] border border-campo py-3 text-[14px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={cerrar}
              // Con descuadre, el motivo es OBLIGATORIO: es la única versión del
              // cobrador sobre lo que pasó, y mañana vale más que cualquier
              // reconstrucción.
              disabled={pendiente || (diferencia !== 0 && notas.trim().length < 5)}
              className="flex-1 rounded-[12px] bg-[#1FA971] py-3 text-[14px] font-extrabold text-white disabled:opacity-60"
            >
              {pendiente
                ? "Cerrando…"
                : diferencia !== 0 && notas.trim().length < 5
                  ? "Escribí el motivo"
                  : "Confirmar cierre"}
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
    <div className="flex items-center justify-between rounded-[12px] bg-suave px-2.5 py-1.5">
      <span className="text-[11.5px] font-medium text-gris">{k}</span>
      <span className="text-[13px] font-extrabold tabular-nums text-tinta">{v}</span>
    </div>
  );
}

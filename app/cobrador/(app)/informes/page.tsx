// ─────────────────────────────────────────────────────────────────────────
//  INFORMES del cobrador (pedido de Carlos, 08-13): el día en números y el
//  detalle uno por uno — "para que ellos puedan revisar bien cómo llevan el día".
//
//  Arriba el RESUMEN con la cuenta completa de la caja:
//    base del día + pagos − retiros − ventas = caja final
//  (los mismos números y funciones del cierre — un solo cálculo en todo el
//  sistema), y abajo los DOS detalles que hasta hoy no existían en ningún lado:
//  cada pago registrado (con cliente y hora) y cada crédito colocado.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { requireUsuario } from "@/lib/auth";
import { getEstadoJornada } from "@/lib/data/rendicion";
import { getInformeDia } from "@/lib/data/informeDia";
import { aFavorDelCobrador, cajaFinal } from "@/lib/rendicion";
import { conTimeout } from "@/lib/timeout";
import { hoyUY } from "@/lib/fecha";
import { UYU, horaDe, diasSemana, meses } from "@/lib/format";
import { EstadoVacio } from "@/components/EstadoVacio";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export default async function InformesPage() {
  const usuario = await requireUsuario();
  // Solo COBRADOR: la jornada y el informe son SUYOS (custodia/colocado por su
  // id). Un gestor acá vería ceros que parecen un bug; su tablero es el panel.
  if (usuario.rol !== "cobrador") redirect("/admin");
  const db = await createSupabaseServer();
  const [jornada, informe] = await conTimeout(
    Promise.all([getEstadoJornada(db, usuario.id), getInformeDia(usuario.id)]),
    TOPE_MS,
    "cobrador.informes",
  );

  const hoy = hoyUY();
  const fechaLarga = `${diasSemana[hoy.getDay()]} ${hoy.getDate()} de ${meses[hoy.getMonth()]}`;
  // LAS MISMAS funciones puras que el cierre (lib/rendicion) — un solo cálculo en
  // todo el sistema. Dos cosas que un `max(0, …)` inline escondía (auditoría
  // 08-14, el mismo bug del aFavor que ya costó un arreglo el 10-08):
  //  · la caja NEGATIVA: el que colocó de su bolsillo tiene que leer "la oficina
  //    te debe", no un $0 que dice que está a mano;
  //  · después de RENDIR, lo entregado se resta — la caja final real es lo que
  //    queda en la mano, no el esperado del día.
  const entregado = jornada.yaRendida?.entregado ?? 0;
  const enMano = cajaFinal(jornada.base, jornada.recaudado, jornada.gastosHoy, entregado, jornada.colocado);
  // Tras rendir, la diferencia vive en el ACTA (sobrante/faltante) — acá el "a
  // favor" solo aplica al día abierto, que es cuando el cobrador decide.
  const aFavor = jornada.yaRendida
    ? 0
    : aFavorDelCobrador(jornada.recaudado, jornada.gastosHoy, jornada.base, jornada.colocado);
  const ventasTotal = jornada.colocado;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[19px] font-extrabold text-tinta">Informe del día</h1>
        <span className="text-[12.5px] font-medium text-gris">{fechaLarga}</span>
      </div>

      {/* ── RESUMEN DE CAJA: la cuenta entera, en el orden en que se piensa ── */}
      <section className="flex flex-col rounded-[16px] bg-tarjeta p-4 shadow-sm">
        <span className="mb-2 text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Resumen de caja
        </span>
        <Fila k="Base del día" v={UYU(jornada.base)} />
        <Fila
          k={`Pagos cobrados (${jornada.cobrosCantidad})`}
          v={`+${UYU(jornada.recaudado)}`}
          tono="var(--color-verde-osc)"
        />
        <Fila
          k="Retiros y gastos"
          v={jornada.gastosHoy > 0 ? `−${UYU(jornada.gastosHoy)}` : UYU(0)}
          tono={jornada.gastosHoy > 0 ? "var(--color-ambar-osc)" : undefined}
        />
        <Fila
          k={`Ventas realizadas (${jornada.creditosColocados})`}
          v={ventasTotal > 0 ? `−${UYU(ventasTotal)}` : UYU(0)}
          tono={ventasTotal > 0 ? "var(--color-azul)" : undefined}
        />
        <div className="mt-2 flex items-center justify-between border-t border-linea pt-2.5">
          <span className="text-[13.5px] font-extrabold text-tinta">Caja final</span>
          <span className="text-[22px] font-black tabular-nums text-tinta">{UYU(enMano)}</span>
        </div>
        {/* Colocó MÁS de lo que tenía encima: la plata salió de su bolsillo y la
            oficina se la debe. Esconder esto tras un $0 fue el bug del aFavor
            (10-08) — acá se dice en verde, igual que en Cerrar jornada. */}
        {aFavor > 0 && (
          <span className="mt-1.5 rounded-[12px] bg-verde-suave px-3 py-2 text-[12px] leading-[1.45] font-bold text-verde-osc">
            💚 Pusiste {UYU(aFavor)} de tu bolsillo (colocaste más de lo que tenías). La oficina
            te lo debe — quedará anotado al cerrar la jornada.
          </span>
        )}
        {jornada.yaRendida ? (
          <span className="mt-1.5 w-fit rounded-full bg-verde-suave px-2.5 py-1 text-[11px] font-bold text-verde-osc">
            Jornada rendida ✓ · entregaste {UYU(jornada.yaRendida.entregado)}
          </span>
        ) : (
          <span className="mt-1.5 text-[11.5px] leading-[1.45] font-medium text-gris">
            Es lo que deberías tener en la mano ahora mismo. Al final del día lo entregás en{" "}
            <Link href="/cobrador#cierre" className="font-bold text-azul underline">
              Cerrar jornada
            </Link>
            .
          </span>
        )}
      </section>

      {/* ── VENTAS DEL DÍA: créditos nuevos y renovaciones, uno por uno ── */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Ventas del día ({informe.colocaciones.length})
        </span>
        {informe.colocaciones.length === 0 ? (
          <EstadoVacio
            icono="cash"
            titulo="Sin ventas todavía"
            texto="Cada crédito que coloques hoy (renovación o venta) aparece acá con su cuota."
          />
        ) : (
          informe.colocaciones.map((c) => (
            <Link
              key={c.prestamoId}
              href={`/cobrador/cliente/${c.clienteId}`}
              className="flex items-center justify-between gap-3 rounded-[14px] bg-tarjeta px-3.5 py-3 shadow-sm active:scale-[0.995]"
            >
              <div className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-[13.5px] leading-[1.25] font-bold break-words text-tinta">
                  {c.clienteNombre}
                </span>
                <span className="text-[11px] font-semibold text-gris tabular-nums">
                  {c.esRenovacion ? "🔁 Renovación" : "💵 Venta"} · cuota {UYU(c.cuota)} ×{" "}
                  {c.totalDias} · {horaDe(c.creadoEn)}
                </span>
              </div>
              <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-azul">
                {UYU(c.monto)}
              </span>
            </Link>
          ))
        )}
      </section>

      {/* ── PAGOS DEL DÍA: el repaso cobro a cobro ── */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Pagos del día ({informe.pagos.length} · {UYU(jornada.recaudado)})
        </span>
        {informe.pagos.length === 0 ? (
          <EstadoVacio
            icono="clock"
            titulo="Sin pagos todavía"
            texto="Cada cobro que registres aparece acá, con el cliente y la hora."
          />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-[14px] bg-tarjeta shadow-sm">
            {informe.pagos.map((p, i) => (
              <Link
                key={p.id}
                href={p.clienteId ? `/cobrador/cliente/${p.clienteId}` : "/cobrador"}
                className={`flex items-center justify-between gap-3 px-3.5 py-2.5 active:bg-app ${
                  i > 0 ? "border-t border-linea" : ""
                }`}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="line-clamp-2 text-[13px] leading-[1.25] font-bold break-words text-tinta">
                    {p.clienteNombre}
                  </span>
                  <span className="text-[10.5px] font-semibold text-tenue tabular-nums">
                    {horaDe(p.registradoEn)}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-verde-osc">
                  {UYU(p.monto)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Los números largos (mes, quincena, comisión) viven en Mis números. */}
      <Link
        href="/cobrador/mis-numeros"
        className="flex items-center justify-between rounded-[14px] border border-campo bg-tarjeta px-4 py-3 active:scale-[0.99]"
      >
        <div className="flex flex-col">
          <span className="text-[13.5px] font-extrabold text-tinta">📈 Mis números del mes</span>
          <span className="text-[11.5px] font-medium text-gris">
            Comisión de la quincena, cobrado del mes y tu historial
          </span>
        </div>
        <span aria-hidden className="text-[15px] font-bold text-azul">→</span>
      </Link>
    </div>
  );
}

function Fila({ k, v, tono }: { k: string; v: string; tono?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12.5px] font-semibold text-gris">{k}</span>
      <span className="text-[14px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {v}
      </span>
    </div>
  );
}

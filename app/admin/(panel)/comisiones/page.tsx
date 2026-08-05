// Comisiones por cobrador (gestor): tasa % sobre lo recaudado del período, con
// liquidación (egreso en caja) y auditoría. Selector Día/Semana/Mes/Año.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getComisionesPeriodo, getHistorialLiquidaciones, etiquetaPeriodoKey, rangoDePeriodoKey } from "@/lib/data/comisiones";
import { normalizarPeriodo, PERIODOS } from "@/lib/data/periodo";
import { alcanceDelActor } from "@/lib/data/alcance";
import { TablaComisiones } from "@/components/admin/TablaComisiones";
import { conTimeout } from "@/lib/timeout";
import { hoyUY } from "@/lib/fecha";
import { toIso } from "@/lib/format";
import { UYU, meses } from "@/lib/format";

// Un agregado colgado LANZA → error.tsx del panel ("Reintentar"), no un 504.
const TOPE_MS = 22_000;

// "YYYY-MM-DD" → "5 jul" (día UY, legible).
function fCorta(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${(meses[Number(m) - 1] ?? "").slice(0, 3)}`;
}

// timestamptz → "9 jul, 20:30" (hora Uruguay).
function fHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const dynamic = "force-dynamic";

// Día vecino de un "YYYY-MM-DD" (aritmética UTC, sin DST — Uruguay no tiene).
const diaVecino = (ymd: string, delta: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + delta * 86400000).toISOString().slice(0, 10);

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; ref?: string }>;
}) {
  // Gestores: el supervisor VE las comisiones de los cobradores; FIJAR la tasa y
  // LIQUIDAR (egreso de caja) queda para el admin (las acciones exigen esAdmin en
  // el server, y la tabla oculta esos botones si no es admin — ver puedeGestionar).
  const usuario = await requireGestor();
  const sp = await searchParams;
  // La comisión se liquida por QUINCENA (decisión 08-05): sin querystring, la
  // pantalla abre en la quincena en curso. Las otras cadencias siguen a un toque.
  const periodo = normalizarPeriodo(sp.periodo ?? "quincena");
  const db = await createSupabaseServer();

  // ?ref=YYYY-MM-DD → mirar (y poder LIQUIDAR) el período que CONTIENE ese día.
  // Sin esto, un período cerrado era inalcanzable: a la medianoche del cierre la
  // clave rotaba y la quincena vencida no se podía pagar nunca. La flecha
  // "‹ anterior" navega período a período hacia atrás.
  const hoyStr = toIso(hoyUY());
  const refRaw = /^\d{4}-\d{2}-\d{2}$/.test(sp.ref ?? "") ? sp.ref! : null;
  const refStr = refRaw && refRaw < hoyStr ? refRaw : null;
  let r = await conTimeout(
    getComisionesPeriodo(db, periodo, refStr ? new Date(`${refStr}T23:59:59.999-03:00`) : new Date()),
    TOPE_MS,
    "admin.comisiones",
  );
  // Normalizar el ancla al PERÍODO completo: si el ref cayó a mitad de un período
  // cerrado se re-ancla a su último día (verlo entero = lo que liquidaría el
  // server); si el período del ref es el ACTUAL, se mira en vivo (hasta ahora).
  const rangoTeo = rangoDePeriodoKey(r.periodoKey);
  if (refStr && rangoTeo) {
    if (rangoTeo.hasta >= hoyStr) {
      r = await conTimeout(getComisionesPeriodo(db, periodo), TOPE_MS, "admin.comisiones");
    } else if (refStr !== rangoTeo.hasta) {
      r = await conTimeout(
        getComisionesPeriodo(db, periodo, new Date(`${rangoTeo.hasta}T23:59:59.999-03:00`)),
        TOPE_MS,
        "admin.comisiones",
      );
    }
  }
  // Historial acotado al ALCANCE del gestor: un supervisor no ve los montos
  // liquidados de otras zonas (mismo recorte que anulaciones).
  const alcance = await alcanceDelActor();
  const historial = await conTimeout(
    getHistorialLiquidaciones(db, 40, alcance.global ? null : alcance.cobradorIds),
    TOPE_MS,
    "admin.comisiones.historial",
  );
  // Navegación: el rango REAL del período mostrado (recalculado tras normalizar).
  const rangoNav = rangoDePeriodoKey(r.periodoKey);
  const refAnterior = rangoNav ? diaVecino(rangoNav.desde, -1) : null;
  const esPasado = !!rangoNav && rangoNav.hasta < hoyStr;
  const refSiguiente = esPasado && rangoNav ? diaVecino(rangoNav.hasta, 1) : null;
  const conRef = (base: string, ref: string | null) => (ref ? `${base}&ref=${ref}` : base);
  const puedeGestionar = esAdmin(usuario.rol);
  // "A liquidar" = solo lo PENDIENTE (los ya liquidados no se vuelven a pagar).
  const aLiquidar = r.filas.filter((f) => !f.liquidado).reduce((s, f) => s + f.comision, 0);
  // ¿El período todavía NO terminó? Si se liquida en curso, se paga solo lo recaudado
  // hasta hoy y el candado (unique por período) deja el resto sin poder liquidarse en
  // la app. Se avisa para que el admin espere al cierre o elija una cadencia cerrada.
  // >= : el DÍA en curso (hasta == hoy) también cuenta como "en curso" — es la cadencia
  // más propensa a liquidarse a mitad de jornada, justo donde más se necesita el aviso.
  const rangoFull = rangoDePeriodoKey(r.periodoKey);
  const periodoEnCurso = !!rangoFull && rangoFull.hasta >= toIso(hoyUY());

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Comisiones</h1>
          {/* Navegar período a período: los CERRADOS también se liquidan (fix 08-05). */}
          <div className="flex items-center gap-2">
            {refAnterior && (
              <Link
                href={conRef(`/admin/comisiones?periodo=${periodo}`, refAnterior)}
                className="rounded-full border border-borde bg-tarjeta px-2.5 py-1 text-[12px] font-bold text-gris hover:text-tinta"
              >
                ‹ anterior
              </Link>
            )}
            <span className="text-[13px] font-medium text-gris">
              {esPasado && <b className="mr-1 rounded bg-suave px-1.5 py-0.5 text-[11px] font-bold text-tinta uppercase">cerrado</b>}
              {r.etiqueta} · del <b className="text-cuerpo">{fCorta(r.desde)}</b> al{" "}
              <b className="text-cuerpo">{fCorta(r.hasta)}</b> · {r.totalCobros} cobro(s).
            </span>
            {refSiguiente && (
              <Link
                href={conRef(`/admin/comisiones?periodo=${periodo}`, refSiguiente)}
                className="rounded-full border border-borde bg-tarjeta px-2.5 py-1 text-[12px] font-bold text-gris hover:text-tinta"
              >
                siguiente ›
              </Link>
            )}
          </div>
        </div>
        <div className="flex rounded-full bg-suave p-0.5">
          {PERIODOS.map((p) => {
            const activo = p.id === periodo;
            return (
              <Link
                key={p.id}
                href={`/admin/comisiones?periodo=${p.id}`}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors ${
                  activo ? "bg-tarjeta text-azul shadow-[0_1px_2px_rgba(26,34,71,0.1)]" : "text-gris hover:text-tinta"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>

      {!r.disponible && (
        <p className="rounded-[12px] bg-ambar-suave px-3.5 py-2.5 text-[12.5px] font-medium text-ambar-osc">
          Las comisiones necesitan una actualización del sistema que todavía no se aplicó.
          Avisale a Carlos (ref: 0014) — mientras tanto la tasa queda en 0%.
        </p>
      )}

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Recaudado</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{UYU(r.totalRecaudado)}</span>
          <span className="text-[11px] font-medium text-tenue">del período</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Cobros</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{r.totalCobros}</span>
          <span className="text-[11px] font-medium text-tenue">
            ticket {UYU(r.totalCobros > 0 ? Math.round(r.totalRecaudado / r.totalCobros) : 0)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-borde bg-tarjeta p-4">
          <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Cobradores</span>
          <span className="text-[19px] font-extrabold tabular-nums text-tinta">{r.filas.length}</span>
          <span className="text-[11px] font-medium text-tenue">
            {r.filas.filter((f) => f.recaudado > 0).length} con cobros
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#DCE6FB] bg-azul-suave p-4">
          <span className="text-[11px] font-bold tracking-wide text-azul uppercase">A liquidar</span>
          <span className="text-[19px] font-extrabold tabular-nums text-verde">{UYU(aLiquidar)}</span>
          <span className="text-[11px] font-medium text-tenue">
            {r.totalLiquidado > 0 ? `${UYU(r.totalLiquidado)} ya liquidado` : "pendiente del período"}
          </span>
        </div>
      </div>

      {puedeGestionar && periodoEnCurso && aLiquidar > 0 && (
        <p className="rounded-[12px] border border-[#F0D9A8] bg-ambar-suave px-3.5 py-2.5 text-[12.5px] font-medium text-ambar-osc">
          <b>Este período todavía no terminó.</b> Si liquidás ahora, se paga solo lo recaudado
          hasta hoy y el resto del período queda <b>bloqueado</b> (no se vuelve a liquidar la misma
          cadencia). Conviene esperar al cierre del período, o liquidar una cadencia ya cerrada.
        </p>
      )}

      <TablaComisiones
        filas={r.filas}
        etiqueta={r.etiqueta}
        periodoKey={r.periodoKey}
        totalRecaudado={r.totalRecaudado}
        puedeGestionar={puedeGestionar}
      />

      {!puedeGestionar && (
        <p className="rounded-[12px] bg-suave px-3.5 py-2.5 text-[12px] font-medium text-gris">
          Estás como supervisor: podés ver las comisiones, pero fijarlas y liquidarlas queda para el administrador.
        </p>
      )}

      {/* Historial de liquidaciones (auditoría legible de lo ya pagado) */}
      {historial.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[0.03em] text-gris">
            Historial de liquidaciones ({historial.length})
          </span>
          <div className="overflow-hidden rounded-[16px] border border-borde bg-tarjeta">
            <ul className="flex flex-col divide-y divide-linea">
              {historial.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold text-tinta">{l.cobradorNombre}</span>
                    <span className="text-[11px] font-medium text-tenue">
                      {etiquetaPeriodoKey(l.periodoKey)}
                      {l.liquidadoPorNombre ? ` · por ${l.liquidadoPorNombre}` : ""} · {fHora(l.liquidadoEn)}
                    </span>
                  </div>
                  <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-verde">
                    {UYU(l.monto)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        La comisión se calcula sobre lo <b>recaudado</b> por cada cobrador en el período. <b>Liquidar</b> registra
        un egreso en la Caja (categoría “Comisión”) y queda en la auditoría — <b>una sola vez por período</b> (si ya
        se liquidó, el botón queda deshabilitado; no se paga dos veces). Los <b>faltantes NO se descuentan acá</b>:
        van a la cuenta corriente y al score de confianza del cobrador (Centro de alertas), que es donde se decide
        cómo recuperarlos.
      </p>
    </div>
  );
}

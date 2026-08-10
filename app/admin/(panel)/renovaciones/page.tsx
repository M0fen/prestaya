// Renovación pre-aprobada (admin/supervisor): clientes con el crédito por
// completar/completado + la recomendación del scoring (acción y monto). El alta
// del nuevo crédito la confirma la oficina; acá está la decisión, servida.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { listarCandidatosRenovacion } from "@/lib/data/renovaciones";
import { getSolicitudesPendientes } from "@/lib/data/solicitudesRenovacion";
import { getAvisosDeLaCalle } from "@/lib/data/misPedidos";
import { alcanceDelActor } from "@/lib/data/alcance";
import type { BandaScore, AccionRenovacion } from "@/types/scoring";
import { UYU } from "@/lib/format";
import { montoRenovacionSugerido, RENOVACION_AUMENTO_PCT } from "@/lib/renovacion";
import { FormRenovacion } from "@/components/admin/FormRenovacion";
import { SolicitudesRenovacion } from "@/components/admin/SolicitudesRenovacion";

export const dynamic = "force-dynamic";

const BANDA: Record<BandaScore, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "#E4F5EC", fg: "#157A50" },
  bueno: { label: "Bueno", bg: "#EAF0FF", fg: "#1E47C8" },
  regular: { label: "Regular", bg: "#FDF3E2", fg: "#B9770E" },
  riesgo: { label: "Riesgo", bg: "#FBE4E2", fg: "#C0392B" },
  nuevo: { label: "Nuevo", bg: "#F2F0FA", fg: "#7A4DD6" },
};

const ACCION: Record<AccionRenovacion, { label: string; bg: string; fg: string }> = {
  preaprobado: { label: "Pre-aprobado", bg: "#1FA971", fg: "#fff" },
  revisar: { label: "Revisar", bg: "#E8A317", fg: "#fff" },
  no_recomendado: { label: "No renovar", bg: "#D64545", fg: "#fff" },
  manual: { label: "Evaluar", bg: "#7A4DD6", fg: "#fff" },
};

export default async function RenovacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const q = ((await searchParams).q ?? "").trim().slice(0, 60);
  // Los avisos que los cobradores dejan con "Pedir a la oficina": hasta hoy caían
  // en la ficha de un cliente entre 13.166 y no los leía NADIE (3 pedidos de primer
  // crédito llevaban dos días esperando). Se recortan por zona con el alcance del
  // gestor: el admin ve todo, el supervisor solo los de su gente.
  const alcance = await alcanceDelActor();
  const [lista, solicitudes, avisos] = await Promise.all([
    listarCandidatosRenovacion(db, new Date(), 0.75, 60, q || null),
    getSolicitudesPendientes(db),
    getAvisosDeLaCalle(alcance.global ? null : alcance.cobradorIds),
  ]);
  const { candidatos, totalQueCalifican, ocultos } = lista;
  const esAdminV = esAdmin(usuario.rol);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
          Renovaciones
        </h1>
        <span className="text-[13px] font-medium text-gris">
          Buenos pagadores por completar su crédito — el mejor momento para
          renovar.
        </span>
      </div>

      {/* Solicitudes pendientes: el admin aprueba/rechaza; el supervisor las ve. */}
      <SolicitudesRenovacion solicitudes={solicitudes} esAdmin={esAdminV} />

      {/* ⚠️ PEDIDOS DE LA CALLE. Los cinco botones de "avisar a la oficina" le
          prometen al cobrador que su pedido "le va a llegar al supervisor y a la
          oficina", y hasta hoy escribían una nota en la ficha de un cliente entre
          13.166: no los leía nadie. Tres pedidos de primer crédito llevaban dos
          días esperando. Van acá, en la pantalla que la oficina ya abre todos los
          días, y ordenados de MÁS VIEJO a más nuevo — que es el orden de la urgencia. */}
      {avisos.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Pedidos de la calle · sin resolver ({avisos.length})
          </span>
          {avisos.map((a) => {
            const viejo = a.horasEsperando >= 24;
            return (
              <Link
                key={a.id}
                href={`/admin/clientes/${a.clienteId}`}
                className="flex flex-col gap-1 rounded-[14px] border p-3.5 active:scale-[0.995]"
                style={{
                  borderColor: viejo ? "#F0C0BC" : "#DCE7FB",
                  background: viejo ? "#FDEEEC" : "#F7F9FF",
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[14px] font-bold text-tinta">{a.clienteNombre}</span>
                  <span
                    className="flex-shrink-0 text-[11.5px] font-bold tabular-nums"
                    style={{ color: viejo ? "#B03A2E" : "#6B7494" }}
                  >
                    {a.horasEsperando < 24
                      ? `hace ${Math.max(1, Math.round(a.horasEsperando))} h`
                      : `esperando hace ${Math.round(a.horasEsperando / 24)} día${a.horasEsperando >= 48 ? "s" : ""}`}
                  </span>
                </div>
                <span className="text-[12.5px] leading-[1.45] font-medium text-[#3A445F]">{a.cuerpo}</span>
                <span className="text-[11px] font-medium text-tenue">Lo pidió {a.cobradorNombre}</span>
              </Link>
            );
          })}
        </section>
      )}

      {/* Buscador por nombre o cédula. Filtra ANTES del corte de la lista: sin esto,
          quien no entraba en los 60 más avanzados era inalcanzable. */}
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o cédula…"
          aria-label="Buscar candidato por nombre o cédula"
          className="min-h-[44px] flex-1 rounded-full border border-borde bg-tarjeta px-4 text-[16px] font-medium text-tinta outline-none focus:border-azul"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-full bg-[#2453DC] px-5 text-[13px] font-bold text-white"
        >
          Buscar
        </button>
        {q && (
          <Link
            href="/admin/renovaciones"
            className="flex min-h-[44px] items-center rounded-full border border-borde bg-tarjeta px-4 text-[13px] font-bold text-gris"
          >
            Limpiar
          </Link>
        )}
      </form>

      {ocultos > 0 && (
        <p className="rounded-[12px] bg-[#FDF3E2] px-4 py-2.5 text-[12.5px] font-semibold text-[#8A6D1E]">
          Hay {totalQueCalifican} clientes en condiciones de renovar y se muestran los {candidatos.length}{" "}
          más avanzados. Buscá por nombre o cédula para llegar a los otros {ocultos}.
        </p>
      )}

      {candidatos.length === 0 && (
        <p className="rounded-[14px] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          {q
            ? `Nadie con "${q}" está cerca de completar su crédito. Si ya lo terminó de pagar, buscalo en Clientes y dale un crédito nuevo desde su ficha.`
            : "Nadie está cerca de completar su crédito todavía. Aparecerán acá al superar el 75% pagado."}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {candidatos.map(({ cliente, progresoPct, completo, cuotasFaltantes, score, prestamoAnterior, moroso }) => {
          const banda = BANDA[score.banda];
          const accion = ACCION[score.recomendacion.accion];
          return (
            <section
              // Por CRÉDITO, no por cliente: un multi-crédito aparece una vez por
              // cada crédito que califica y con `key={cliente.id}` React veía dos
              // hermanos con la misma llave (7 clientes hoy) y podía reciclar el
              // nodo equivocado — el gestor renovaba mirando la tarjeta de al lado.
              key={prestamoAnterior.id}
              className="rounded-[16px] border border-borde bg-tarjeta p-4"
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[#2453DC] text-[16px] font-black text-white">
                  {cliente.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/admin/clientes/${cliente.id}`}
                    className="truncate text-[15px] font-extrabold text-tinta hover:text-azul"
                  >
                    {cliente.nombre}
                  </Link>
                  <span className="text-[12px] font-medium text-gris">
                    {completo ? "Crédito completado ✓" : `A ${cuotasFaltantes} cuota${cuotasFaltantes === 1 ? "" : "s"} de terminar`}
                  </span>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  {moroso && (
                    <span className="rounded-full bg-[#FBE4E2] px-2.5 py-1 text-[11px] font-bold text-[#C0392B]">
                      ⛔ Moroso
                    </span>
                  )}
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: banda.bg, color: banda.fg }}
                  >
                    {banda.label} · {score.puntaje}
                  </span>
                </div>
              </div>

              {/* Progreso del crédito actual */}
              <div className="mb-3 h-[8px] w-full overflow-hidden rounded-full bg-linea">
                <div
                  className="h-full rounded-full bg-[#1FA971]"
                  style={{ transformOrigin: "left", transform: `scaleX(${progresoPct / 100})` }}
                />
              </div>

              {/* Recomendación */}
              <div className="flex items-center justify-between gap-3 rounded-[12px] bg-suave p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[11px] font-semibold text-gris">
                    Recomendación
                  </span>
                  <span className="text-[12.5px] font-medium text-tinta">
                    {score.recomendacion.resumen}
                  </span>
                  {/* El monto NO lo inventa el scoring: renovar es REPETIR el
                      crédito que la persona terminó. El scoring aporta la
                      recomendación (renovar / revisar / no), que es lo que sabe
                      hacer; la plata la fija la regla. */}
                  <span className="mt-0.5 text-[13px] font-extrabold text-tinta">
                    Renovación: {UYU(montoRenovacionSugerido(prestamoAnterior.monto))}
                    <span className="font-semibold text-gris"> (el mismo crédito)</span>
                  </span>
                </div>
                <span
                  className="flex-shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-bold"
                  style={{ background: accion.bg, color: accion.fg }}
                >
                  {accion.label}
                </span>
              </div>

              {/* Alta real: solo si el crédito actual está saldado. */}
              {completo ? (
                <FormRenovacion
                  clienteId={cliente.id}
                  clienteNombre={cliente.nombre}
                  anterior={prestamoAnterior}
                  esAdmin={esAdminV}
                  moroso={moroso}
                />
              ) : (
                <p className="mt-3 text-center text-[11.5px] font-medium text-tenue-2">
                  Se podrá renovar cuando termine de pagar el crédito actual.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        El puntaje sale del comportamiento de pago propio del cliente (interno, no se le
        muestra). El supervisor puede <b>solicitar</b> la renovación; el <b>administrador</b> la
        aprueba y crea el crédito.
      </p>
    </div>
  );
}

// Renovación pre-aprobada (admin/supervisor): clientes con el crédito por
// completar/completado + la recomendación del scoring (acción y monto). El alta
// del nuevo crédito la confirma la oficina; acá está la decisión, servida.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getCandidatosRenovacion } from "@/lib/data/renovaciones";
import { getSolicitudesPendientes } from "@/lib/data/solicitudesRenovacion";
import type { BandaScore, AccionRenovacion } from "@/types/scoring";
import { UYU } from "@/lib/format";
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

export default async function RenovacionesPage() {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const [candidatos, solicitudes] = await Promise.all([
    getCandidatosRenovacion(db),
    getSolicitudesPendientes(db),
  ]);
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

      {candidatos.length === 0 && (
        <p className="rounded-[14px] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          Nadie está cerca de completar su crédito todavía. Aparecerán acá al
          superar el 75% pagado.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {candidatos.map(({ cliente, progresoPct, completo, cuotasFaltantes, score, prestamoAnterior, moroso }) => {
          const banda = BANDA[score.banda];
          const accion = ACCION[score.recomendacion.accion];
          return (
            <section
              key={cliente.id}
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
                  {score.recomendacion.montoSugerido != null && (
                    <span className="mt-0.5 text-[13px] font-extrabold text-tinta">
                      Monto sugerido: {UYU(score.recomendacion.montoSugerido)}
                    </span>
                  )}
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
                  montoSugerido={score.recomendacion.montoSugerido}
                  esAdmin={esAdminV}
                  moroso={moroso}
                />
              ) : (
                <p className="mt-3 text-center text-[11.5px] font-medium text-[#AEB6CC]">
                  Se podrá renovar cuando termine de pagar el crédito actual.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        El puntaje sale del comportamiento de pago propio del cliente (interno, no se le
        muestra). El supervisor puede <b>solicitar</b> la renovación; el <b>administrador</b> la
        aprueba y crea el crédito.
      </p>
    </div>
  );
}

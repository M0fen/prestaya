// Ficha completa del cliente (admin/supervisor): datos, calificación + score,
// crédito activo con cartón real, mora, historial de pagos y de créditos, notas.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getFichaCliente } from "@/lib/data/ficha";
import { getSaldoEstrellas } from "@/lib/data/estrellas";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { getPrestamoActivoPorCliente } from "@/lib/data/prestamos";
import { claveCiclo } from "@/lib/estrellas";
import { cicloUY } from "@/lib/fecha";
import { NotasCliente } from "@/components/notas/NotasCliente";
import { MorosidadCliente } from "@/components/admin/MorosidadCliente";
import { ScoreEvolucion } from "@/components/admin/ScoreEvolucion";
import { getMorosidadCliente, getNotasMora } from "@/lib/data/morosidad";
import { UYU, meses, horaDe } from "@/lib/format";
import type { EstadoDia } from "@/types/cartones";
import type { Calificacion, Prestamo } from "@/types/db";

export const dynamic = "force-dynamic";

const COLOR: Record<EstadoDia, string> = {
  pagado: "#1FA971",
  pendiente: "#E8A317",
  atrasado: "#E06A6A",
  futuro: "#EEF1F8",
};
const BANDA: Record<Calificacion, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "#E4F5EC", fg: "#157A50" },
  bueno: { label: "Bueno", bg: "#EAF0FF", fg: "#1E47C8" },
  regular: { label: "Regular", bg: "#FDF3E2", fg: "#B9770E" },
  riesgo: { label: "Riesgo", bg: "#FBE4E2", fg: "#C0392B" },
  nuevo: { label: "Nuevo", bg: "#F2F0FA", fg: "#7A4DD6" },
};
const ESTADO_CREDITO: Record<Prestamo["estado"], string> = {
  activo: "Activo",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
  incobrable: "Incobrable",
};

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${meses[d.getMonth()].slice(0, 3)}`;
}

export default async function FichaClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const ficha = await getFichaCliente(db, id);
  if (!ficha) notFound();

  const { cliente, score, evolucionScore: evolucion, activo, creditos, pagos, notas } = ficha;
  const banda = BANDA[cliente.calificacion] ?? BANDA.nuevo;
  const bandaScore = BANDA[score.banda as Calificacion] ?? BANDA.nuevo;

  // Saldo de estrellas del cliente (respeta el ciclo definido por el admin).
  const [ajustes, prestamoAct, morosidad, notasMora] = await Promise.all([
    getAjustesJuego(db),
    getPrestamoActivoPorCliente(db, id),
    getMorosidadCliente(db, id),
    getNotasMora(db, id),
  ]);
  const estrellas = await getSaldoEstrellas(
    db,
    id,
    claveCiclo(ajustes.estrellasCiclo, { cicloMes: cicloUY(), prestamoId: prestamoAct?.id ?? null }),
  );

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/clientes" className="text-[13px] font-semibold text-gris">
          ← Clientes
        </Link>
        <Link
          href={`/admin/clientes/${id}/estado`}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#DCE3F4] px-3.5 py-1.5 text-[12.5px] font-bold text-azul hover:bg-[#F4F6FB]"
        >
          🧾 Estado de cuenta
        </Link>
      </div>

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#2453DC] text-[22px] font-black text-white">
          {cliente.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[20px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="text-[12.5px] font-medium text-gris">
            {cliente.documento ?? "Sin documento"} · {cliente.telefono ?? "Sin teléfono"}
          </span>
          <span className="text-[12px] font-medium text-[#8A93AD]">
            {cliente.direccion ?? "Sin dirección"} · alta: {cliente.origen}
          </span>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {morosidad.moroso && (
            <span className="rounded-full bg-[#FBE4E2] px-3 py-1.5 text-[12px] font-bold text-[#C0392B]">
              ⛔ Moroso
            </span>
          )}
          <span
            className="rounded-full px-3 py-1.5 text-[12px] font-bold"
            style={{ background: banda.bg, color: banda.fg }}
          >
            {banda.label}
          </span>
        </div>
      </div>

      {/* Score interno */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold text-tinta">Score interno</span>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: bandaScore.bg, color: bandaScore.fg }}
          >
            {bandaScore.label} · {score.puntaje}/1000
          </span>
        </div>
        <p className="mb-2 text-[12.5px] font-medium text-gris">{score.recomendacion.resumen}</p>
        <div className="flex flex-wrap gap-1.5">
          {score.factores.map((f) => (
            <span
              key={f.clave}
              className="rounded-full bg-[#F4F6FB] px-2.5 py-1 text-[11px] font-semibold text-[#6B7494]"
              title={f.detalle}
            >
              {f.etiqueta}: {f.puntos > 0 ? "+" : ""}
              {f.puntos}
            </span>
          ))}
        </div>
      </section>

      {/* Evolución del score en el tiempo (derivada, mensual) */}
      <ScoreEvolucion serie={evolucion} />

      {/* Morosidad: marca de lista negra + motivos/acuerdos de pago */}
      <MorosidadCliente clienteId={id} inicial={morosidad} notas={notasMora} />

      {/* Estrellas del cliente (recompensa real) */}
      <section className="rounded-[16px] border border-[#F0E2A8] bg-[linear-gradient(180deg,#FFFDF5,#FFF8E6)] p-4">
        <div className="flex items-center gap-2">
          <span className="text-[18px]" aria-hidden="true">⭐</span>
          <span className="text-[13px] font-bold text-[#8A6D1E]">Estrellas</span>
          <span className="ml-auto text-[11px] font-medium text-[#A98B3E]">
            ciclo: {ajustes.estrellasCiclo === "mes" ? "mensual" : "por crédito"}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <EstrellaKpi label="Disponibles" valor={estrellas.disponibles} fuerte />
          <EstrellaKpi label="Ganadas (total)" valor={estrellas.estrellasGanadas} />
          <EstrellaKpi label="Redimidas" valor={estrellas.estrellasRedimidas} />
          <EstrellaKpi
            label="Pendientes"
            valor={estrellas.estrellasPendientes}
            acento={estrellas.estrellasPendientes > 0 ? "#C79A1E" : undefined}
          />
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-[#A98B3E]">
          Progreso a la próxima: {estrellas.progresoFragmento}/5 pagos · puede canjear ahora:{" "}
          {estrellas.redimiblesCiclo}
          {estrellas.estrellasPendientes > 0 ? " · tiene un canje esperando aprobación" : ""}
        </p>
      </section>

      {/* Crédito activo + cartón */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <span className="text-[13px] font-bold text-tinta">Crédito activo</span>
        {!activo ? (
          <p className="mt-2 text-[13px] font-medium text-gris">
            Sin crédito activo. El alta de créditos la hace la oficina.
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Kpi label="Cuota diaria" valor={UYU(activo.cuota)} />
              <Kpi label="Saldo" valor={UYU(activo.saldo)} />
              <Kpi
                label="Deuda vencida"
                valor={UYU(activo.deudaVencida)}
                acento={activo.deudaVencida > 0 ? "#C0392B" : undefined}
              />
              <Kpi
                label="Días atraso"
                valor={String(activo.diasAtraso)}
                acento={activo.diasAtraso > 0 ? "#C0392B" : undefined}
              />
            </div>
            <div className="mt-3 rounded-[14px] bg-[#F1E8D2] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-[#8A6D1E]">
                  Cartón · {activo.pagados}/{activo.totalDias} días
                </span>
                <span className="text-[11px] font-medium text-[#a98b3e]">
                  {activo.progresoPct}% pagado
                </span>
              </div>
              <div className="grid grid-cols-10 gap-1.5">
                {activo.dias.map((d) => (
                  <div
                    key={d.dia}
                    className="flex aspect-square items-center justify-center rounded-[8px] text-[10px] font-bold"
                    style={{
                      background: COLOR[d.estado],
                      color: d.estado === "futuro" ? "#B3A488" : "#fff",
                      boxShadow: d.esHoy ? "0 0 0 2px #13308C" : "none",
                    }}
                  >
                    {d.estado === "pagado" ? "✓" : d.dia}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Historial de pagos */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <span className="text-[13px] font-bold text-tinta">Historial de pagos</span>
        {pagos.length === 0 ? (
          <p className="mt-2 text-[13px] font-medium text-gris">Todavía no hay pagos registrados.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-[#EEF1F8]">
            {pagos.map((p, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <div className="flex flex-col">
                  <span className="text-[13.5px] font-semibold text-tinta">
                    {fechaCorta(p.fecha)} · {horaDe(p.fecha)}
                  </span>
                  <span className="text-[11.5px] font-medium text-[#8A93AD]">
                    Día {p.dia}
                    {p.registradoPor ? ` · ${p.registradoPor}` : ""}
                  </span>
                </div>
                <span className="text-[14px] font-extrabold text-tinta tabular-nums">
                  {UYU(p.monto)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Historial de créditos */}
      <section className="rounded-[16px] border border-[#E6EAF4] bg-white p-4">
        <span className="text-[13px] font-bold text-tinta">Créditos</span>
        <ul className="mt-2 flex flex-col gap-2">
          {creditos.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-[12px] bg-[#F7F9FD] px-3 py-2.5"
            >
              <div className="flex flex-col">
                <span className="text-[13.5px] font-bold text-tinta">
                  {UYU(c.monto)} · cuota {UYU(c.cuota)} × {c.totalDias}
                </span>
                <span className="text-[11.5px] font-medium text-[#8A93AD]">
                  Desde {fechaCorta(c.fechaInicio)} · pagó {UYU(c.pagadoTotal)}
                </span>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#6B7494]">
                {ESTADO_CREDITO[c.estado]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Notas del equipo */}
      <NotasCliente clienteId={cliente.id} notas={notas} yoId={usuario.id} puedeGestionar />
    </div>
  );
}

function EstrellaKpi({
  label,
  valor,
  acento,
  fuerte,
}: {
  label: string;
  valor: number;
  acento?: string;
  fuerte?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-white/70 p-3">
      <span className="text-[11px] font-semibold text-[#A98B3E]">{label}</span>
      <span
        className="text-[18px] font-black tabular-nums"
        style={{ color: acento ?? (fuerte ? "#C79A1E" : "#8A6D1E") }}
      >
        {valor}
      </span>
    </div>
  );
}

function Kpi({ label, valor, acento }: { label: string; valor: string; acento?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-[#F7F9FD] p-3">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span
        className="text-[16px] font-extrabold tabular-nums"
        style={{ color: acento ?? "#1A2247" }}
      >
        {valor}
      </span>
    </div>
  );
}

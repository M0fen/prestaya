// Ficha completa del cliente (admin/supervisor): datos, calificación + score,
// crédito activo con cartón real, mora, historial de pagos y de créditos, notas.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGestor, esAdmin as esAdminRol, getActorActual } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getFichaCliente } from "@/lib/data/ficha";
import { getPendientesDePagos } from "@/lib/data/anulaciones";
import { getCobradorDeCliente } from "@/lib/data/asignaciones";
import { getEquipoConZona } from "@/lib/data/zonas";
import { alcanceDelActor } from "@/lib/data/alcance";
import { puedeReasignarCliente } from "@/lib/permisos";
import { AnularPago } from "@/components/admin/AnularPago";
import { RegistrarPagoPanel } from "@/components/admin/RegistrarPagoPanel";
import { ReasignarCliente, type CobradorOpcion } from "@/components/admin/ReasignarCliente";
import { FormCreditoNuevo } from "@/components/admin/FormCreditoNuevo";
import { getUltimoCreditoDe } from "@/lib/data/creditoNuevo";
import { RotarToken } from "@/components/admin/RotarToken";
import { AccesoQrCliente } from "@/components/admin/AccesoQrCliente";
import { urlCartonCliente } from "@/lib/urlApp";
import { ToggleReportado } from "@/components/admin/ToggleReportado";
import { FotoClienteAdmin } from "@/components/admin/FotoClienteAdmin";
import { urlFirmadaFoto } from "@/lib/data/fotos";
import { getSaldoEstrellas } from "@/lib/data/estrellas";
import { getAjustesJuego } from "@/lib/data/juegoConfig";
import { claveCiclo } from "@/lib/estrellas";
import { cicloUY } from "@/lib/fecha";
import { NotasCliente } from "@/components/notas/NotasCliente";
import { HistorialCreditos } from "@/components/HistorialCreditos";
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
  refinanciado: "Refinanciado",
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

  const { cliente, score, evolucionScore: evolucion, activos, creditos, pagos, notas } = ficha;
  // URL firmada (temporal) de la foto del cliente, si tiene.
  const fotoUrl = await urlFirmadaFoto(cliente.foto_path);
  const banda = BANDA[cliente.calificacion] ?? BANDA.nuevo;
  const bandaScore = BANDA[score.banda as Calificacion] ?? BANDA.nuevo;

  // Anulación de pagos (doble registro): qué pagos ya tienen solicitud pendiente.
  const puedeAnular = esAdminRol(usuario.rol);
  const pendientesAnulacion = await getPendientesDePagos(db, pagos.map((p) => p.id));

  // Reasignación de cobrador (decisión 4). Candidatos según rol: admin = todos;
  // supervisor = sus cobradores de la MISMA zona que el cobrador actual.
  const [actor, cobradorActual, equipo] = await Promise.all([
    getActorActual(),
    getCobradorDeCliente(db, id),
    getEquipoConZona(db),
  ]);
  const cobradores = equipo.filter((u) => u.rol === "cobrador" && u.activo);
  const zonaActual = cobradorActual?.zonaId ?? null;
  const puedeReasignar = actor ? puedeReasignarCliente(actor, zonaActual, zonaActual) : false;
  const candidatos: CobradorOpcion[] = (
    actor?.rol === "admin"
      ? cobradores
      : cobradores.filter((c) => c.zona_id != null && c.zona_id === zonaActual)
  ).map((c) => ({ id: c.id, nombre: c.nombre }));

  // ── Alta de crédito NUEVO (cliente sin crédito activo) ──
  // Cobradores elegibles = los MISMOS que acepta la Server Action (alcance por
  // zona), no los de `candidatos`: ese filtro se ancla en la zona del cobrador
  // ACTUAL, que para un cliente sin ruta es null → le habría dado una lista
  // vacía al supervisor justo en el caso que este formulario existe para cubrir.
  const alcanceAlta = activos.length === 0 ? await alcanceDelActor(actor) : null;
  const cobradoresAlta: CobradorOpcion[] =
    alcanceAlta == null
      ? []
      : (alcanceAlta.global
          ? cobradores
          : cobradores.filter((c) => alcanceAlta.cobradorIds.includes(c.id))
        ).map((c) => ({ id: c.id, nombre: c.nombre }));
  const ultimoCredito = activos.length === 0 ? await getUltimoCreditoDe(db, id) : null;

  // Saldo de estrellas del cliente (respeta el ciclo definido por el admin).
  // Con varios créditos activos, el ciclo "por crédito" se ancla en el principal.
  const [ajustes, morosidad, notasMora] = await Promise.all([
    getAjustesJuego(db),
    getMorosidadCliente(db, id),
    getNotasMora(db, id),
  ]);
  const estrellas = await getSaldoEstrellas(
    db,
    id,
    claveCiclo(ajustes.estrellasCiclo, { cicloMes: cicloUY(), prestamoId: activos[0]?.id ?? null }),
  );

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/clientes" className="text-[13px] font-semibold text-gris">
          ← Clientes
        </Link>
        <Link
          href={`/admin/clientes/${id}/estado`}
          className="inline-flex items-center gap-1.5 rounded-full border border-borde px-3.5 py-1.5 text-[12.5px] font-bold text-azul hover:bg-suave"
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
          <span className="text-[12px] font-medium text-tenue">
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

      {/* Datos adicionales (paridad Disapp): género, ciudad, dirección secundaria */}
      {(cliente.genero || cliente.ciudad || cliente.direccion_secundaria) && (
        <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
          <span className="text-[13px] font-bold text-tinta">Datos adicionales</span>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
            {cliente.genero && (
              <DatoFicha k="Género" v={cliente.genero.charAt(0).toUpperCase() + cliente.genero.slice(1)} />
            )}
            {cliente.ciudad && <DatoFicha k="Ciudad" v={cliente.ciudad} />}
            {cliente.direccion_secundaria && (
              <DatoFicha k="Dirección secundaria" v={cliente.direccion_secundaria} />
            )}
          </dl>
        </section>
      )}

      {/* Foto del cliente (ver / cargar / actualizar) */}
      <FotoClienteAdmin clienteId={id} fotoUrl={fotoUrl} />

      {/* Reportado a buró / lista de morosos (solo admin puede cambiarlo) */}
      {puedeAnular && <ToggleReportado clienteId={id} inicial={cliente.reportado} />}

      {/* Score interno */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
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
              className="rounded-full bg-suave px-2.5 py-1 text-[11px] font-semibold text-gris"
              title={f.detalle}
            >
              {f.etiqueta}: {f.puntos > 0 ? "+" : ""}
              {f.puntos}
            </span>
          ))}
        </div>
      </section>

      {/* Cobrador asignado + reasignación (según rol/zona) */}
      <ReasignarCliente
        clienteId={id}
        actualId={cobradorActual?.cobradorId ?? null}
        actualNombre={cobradorActual?.cobradorNombre ?? "Sin cobrador asignado"}
        candidatos={candidatos}
        puedeReasignar={puedeReasignar}
      />

      {/* Link de acceso del cliente + regenerar (solo admin) */}
      {puedeAnular && <RotarToken clienteId={id} token={cliente.token_acceso} />}

      {/* El MISMO QR que entrega el cobrador + estado del alta del cliente. */}
      <AccesoQrCliente
        nombre={cliente.nombre}
        url={await urlCartonCliente(cliente.token_acceso)}
        acceso={cliente}
      />


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

      {/* Créditos activos + cartón (desde 0037 pueden ser VARIOS) */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-tinta">
            {activos.length > 1 ? `Créditos activos (${activos.length})` : "Crédito activo"}
          </span>
        </div>
        {activos.length === 0 ? (
          <>
            <p className="mt-2 text-[13px] font-medium text-gris">
              {ultimoCredito
                ? `Sin crédito activo. Su último crédito (${ESTADO_CREDITO[ultimoCredito.estado as Prestamo["estado"]] ?? ultimoCredito.estado}) empezó el ${fechaCorta(ultimoCredito.fechaInicio)}.`
                : "Sin crédito activo. Todavía no tuvo ninguno."}
            </p>
            <FormCreditoNuevo
              clienteId={id}
              clienteNombre={cliente.nombre}
              base={
                ultimoCredito
                  ? {
                      monto: ultimoCredito.monto,
                      cuota: ultimoCredito.cuota,
                      totalDias: ultimoCredito.totalDias,
                      frecuencia: ultimoCredito.frecuencia,
                      fechaInicio: ultimoCredito.fechaInicio,
                      estado: ultimoCredito.estado,
                    }
                  : null
              }
              cobradores={cobradoresAlta}
              cobradorSugerido={ultimoCredito?.cobradorId ?? cobradorActual?.cobradorId ?? null}
              esAdmin={esAdminRol(usuario.rol)}
              moroso={morosidad.moroso}
              reportado={cliente.reportado}
            />
          </>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {activos.map((activo, idx) => (
              <div
                key={activo.id}
                className={idx > 0 ? "border-t border-linea pt-4" : ""}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activo.origen === "tienda" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#E7ECFF] px-2.5 py-1 text-[11px] font-bold text-[#13308C]">
                        🛒 Tienda{activo.productoNombre ? ` · ${activo.productoNombre}` : ""} · desde {fechaCorta(activo.fechaInicio)}
                      </span>
                    )}
                    {/* Fecha de inicio SIEMPRE visible (antes solo con múltiples créditos). */}
                    {(activos.length > 1 || activo.origen !== "tienda") && (
                      <span className="inline-block rounded-full bg-[#EAF0FF] px-2.5 py-1 text-[11px] font-bold text-[#1E47C8]">
                        {activos.length > 1 ? `Crédito ${idx + 1} · ` : ""}desde {fechaCorta(activo.fechaInicio)}
                      </span>
                    )}
                    {/* Linaje (0116): este crédito vino de renovar uno anterior. */}
                    {activo.renovadoDe && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#EDE7FB] px-2.5 py-1 text-[11px] font-bold text-[#6D4AC7]">🔄 Renovación</span>
                    )}
                  </div>
                  <RegistrarPagoPanel clienteId={id} prestamoId={activo.id} cuota={activo.cuota} />
                </div>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
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
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Historial de pagos */}
      <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
        <span className="text-[13px] font-bold text-tinta">Historial de pagos</span>
        {pagos.length === 0 ? (
          <p className="mt-2 text-[13px] font-medium text-gris">Todavía no hay pagos registrados.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-linea">
            {pagos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[13.5px] font-semibold text-tinta">
                    {fechaCorta(p.fecha)} · {horaDe(p.fecha)}
                  </span>
                  <span className="text-[11.5px] font-medium text-tenue">
                    Día {p.dia}
                    {p.registradoPor ? ` · ${p.registradoPor}` : ""}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <span className="text-[14px] font-extrabold text-tinta tabular-nums">
                    {UYU(p.monto)}
                  </span>
                  <AnularPago
                    pagoId={p.id}
                    esAdmin={puedeAnular}
                    pendiente={pendientesAnulacion.has(p.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Historial de créditos — misma vista que ve el cobrador en la calle:
          tipo (renovación / venta nueva / tienda / importado), vuelta de la
          cadena, quién lo colocó y CÓMO lo pagó (días reales contra el plazo). */}
      <HistorialCreditos creditos={creditos} titulo="Créditos" />

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

function DatoFicha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col py-1">
      <dt className="text-[11px] font-semibold text-tenue">{k}</dt>
      <dd className="text-[13px] font-semibold text-tinta">{v}</dd>
    </div>
  );
}

function Kpi({ label, valor, acento }: { label: string; valor: string; acento?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-suave p-3">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span
        className="text-[16px] font-extrabold tabular-nums"
        style={{ color: acento ?? "var(--color-tinta)" }}
      >
        {valor}
      </span>
    </div>
  );
}

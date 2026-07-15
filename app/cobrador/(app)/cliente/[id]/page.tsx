// Detalle del cliente para el cobrador: cartón REAL (calcularEstadosCarton) +
// resumen + registro de cobro/no pago con GPS y geo-cerca. Lectura por RLS.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { requireUsuario, esGestor } from "@/lib/auth";
import { getClientePorId } from "@/lib/data/clientes";
import { getPrestamosActivosPorCliente } from "@/lib/data/prestamos";
import { getPagosDePrestamo } from "@/lib/data/pagos";
import { getNotasCliente } from "@/lib/data/notas";
import { getGestionesCliente, type Gestion } from "@/lib/data/gestionesCobranza";
import { calcularEstadosCarton } from "@/lib/cartones";
import { hoyUY } from "@/lib/fecha";
import type { Prestamo } from "@/types/db";
import { UYU } from "@/lib/format";
import { RegistroCobro } from "@/components/cobrador/RegistroCobro";
import { CartonCobrador } from "@/components/cobrador/CartonCobrador";
import { CobrosRecientes, type PagoReciente } from "@/components/cobrador/CobrosRecientes";
import { RegistrarCompromiso } from "@/components/cobrador/RegistrarCompromiso";
import { BeaconFicha } from "@/components/cobrador/BeaconFicha";
import { NotasCliente } from "@/components/notas/NotasCliente";

export const dynamic = "force-dynamic";

export default async function DetalleClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ credito?: string }>;
}) {
  const { id } = await params;
  const { credito } = await searchParams;
  const db = await createSupabaseServer();

  // Independientes (usuario aparte; cliente/activos/notas por id) → en PARALELO
  // (antes 4 round-trips en serie antes de poder resolver el cartón).
  const [usuario, cliente, activos, notas] = await Promise.all([
    requireUsuario(),
    getClientePorId(db, id),
    getPrestamosActivosPorCliente(db, id),
    getNotasCliente(db, id),
  ]);
  if (!cliente) notFound();

  // Un cliente puede tener VARIOS créditos activos (0037). El cobrador elige a
  // cuál imputa; por defecto, el principal (el más nuevo).
  const prestamo = activos.find((p) => p.id === credito) ?? activos[0] ?? null;
  // Inicial del avatar con fallback: un cliente importado sin nombre no debe
  // tumbar la ficha (charAt sobre null/undefined tira). "—" si no hay letra.
  const inicial = (cliente.nombre ?? "").trim().charAt(0).toUpperCase() || "—";

  // "Cómo llegar": deep-link a Google Maps con el GPS del cliente (o la dirección).
  // Le ahorra al cobrador —sobre todo en ruta nueva/reasignada— buscar la casa a mano.
  const mapsUrl =
    cliente.gps_lat != null && cliente.gps_lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${cliente.gps_lat},${cliente.gps_lng}`
      : cliente.direccion
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cliente.direccion)}`
        : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Bitácora: registra que el cobrador abrió esta ficha, con GPS. */}
      {!esGestor(usuario.rol) && <BeaconFicha clienteId={id} />}
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Ruta
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] bg-[#2453DC] text-[22px] font-black text-white">
          {inicial}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[19px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="truncate text-[12.5px] font-medium text-gris">
            {cliente.direccion ?? "Sin dirección"}
          </span>
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-shrink-0 items-center gap-1 rounded-full bg-[#EEF3FF] px-3 py-2 text-[12.5px] font-bold text-azul active:scale-95"
          >
            📍 Cómo llegar
          </a>
        )}
      </div>

      {/* Selector de crédito: solo si el cliente tiene MÁS DE UNO activo. */}
      {activos.length > 1 && prestamo && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-gris">
            {activos.length} créditos activos — elegí a cuál imputás:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {activos.map((p, i) => {
              const activo = p.id === prestamo.id;
              return (
                <Link
                  key={p.id}
                  href={`/cobrador/cliente/${id}?credito=${p.id}`}
                  scroll={false}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
                    activo
                      ? "bg-[#1E47C8] text-white"
                      : "border border-[#DCE3F4] bg-white text-[#6B7494]"
                  }`}
                >
                  Crédito {i + 1} · {UYU(p.cuota_diaria)}/día
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!prestamo ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Este cliente no tiene un crédito activo. El alta de créditos la hace la
          oficina.
        </p>
      ) : (
        <Detalle
          db={db}
          clienteId={id}
          cliente={cliente}
          prestamo={prestamo}
          cobradorNombre={usuario.nombre}
          cobradorId={usuario.id}
        />
      )}

      <NotasCliente
        clienteId={id}
        notas={notas}
        yoId={usuario.id}
        puedeGestionar={esGestor(usuario.rol)}
      />
    </div>
  );
}

async function Detalle({
  db,
  clienteId,
  cliente,
  prestamo,
  cobradorNombre,
  cobradorId,
}: {
  db: Awaited<ReturnType<typeof createSupabaseServer>>;
  clienteId: string;
  cliente: Awaited<ReturnType<typeof getClientePorId>>;
  prestamo: Prestamo;
  cobradorNombre: string;
  cobradorId: string;
}) {
  const pagos = await getPagosDePrestamo(db, prestamo.id);
  const r = calcularEstadosCarton(prestamo, pagos, hoyUY());

  // Compromiso de pago abierto (mini-CRM) + la nota que dejó el cobrador/gestor,
  // para confirmarlo desde el cartón. El más reciente con promesa gana.
  const gestiones = await getGestionesCliente(db, clienteId);
  const compromiso =
    gestiones.find((g) => g.montoCompromiso != null && g.fechaCompromiso != null) ?? null;

  // Cobros recientes (últimas 2 h) → permiten "deshacer" dentro de 1 h.
  const DOS_HORAS = 2 * 60 * 60 * 1000;
  const ahora = Date.now();
  const recientes: PagoReciente[] = pagos
    .filter((p) => p.registrado_en && ahora - new Date(p.registrado_en).getTime() < DOS_HORAS)
    .sort((a, b) => new Date(b.registrado_en).getTime() - new Date(a.registrado_en).getTime())
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      monto: Number(p.monto),
      registradoEn: p.registrado_en as string,
      esMio: p.registrado_por === cobradorId,
    }));
  const cubiertos = r.dias.filter((d) => d.estado === "pagado").length;
  const atrasados = r.dias.filter((d) => d.estado === "atrasado").length;
  const tieneGps = Boolean(cliente?.gps_lat != null && cliente?.gps_lng != null);
  const tonoAtraso = atrasados > 0 ? { bg: "#FBE4E2", fg: "#C0392B" } : { bg: "#FDF3E2", fg: "#9A6A0E" };

  return (
    <>
      {/* Resumen */}
      <div className="grid grid-cols-2 gap-2.5">
        <Resumen label="Cuota diaria" valor={UYU(prestamo.cuota_diaria)} />
        <Resumen label="Saldo" valor={UYU(r.falta)} />
        <Resumen label="Días cubiertos" valor={`${cubiertos}/${prestamo.total_dias}`} />
        <Resumen label="Total" valor={UYU(r.totalAPagar)} />
      </div>

      {/* Cuánto para ponerse al día — el cobrador no lo tiene que deducir del cartón. */}
      {r.montoParaAlDia > 0 ? (
        <div className="flex items-center justify-between rounded-[14px] px-4 py-3" style={{ background: tonoAtraso.bg }}>
          <div className="flex flex-col">
            <span className="text-[13px] font-extrabold" style={{ color: tonoAtraso.fg }}>
              {atrasados > 0
                ? `Debe ${atrasados} cuota${atrasados === 1 ? "" : "s"} atrasada${atrasados === 1 ? "" : "s"}`
                : "Cuota de hoy pendiente"}
            </span>
            <span className="text-[11.5px] font-medium" style={{ color: tonoAtraso.fg }}>
              Para ponerse al día
            </span>
          </div>
          <span className="text-[20px] font-black tabular-nums" style={{ color: tonoAtraso.fg }}>
            {UYU(r.montoParaAlDia)}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-[14px] bg-[#E4F5EC] px-4 py-2.5">
          <span className="text-[14px]">✅</span>
          <span className="text-[12.5px] font-bold text-[#157A50]">Está al día. Solo la cuota de hoy si corresponde.</span>
        </div>
      )}

      {/* Cartón real (con reflejo en vivo del cobro recién registrado). */}
      <CartonCobrador
        dias={r.dias}
        cuota={prestamo.cuota_diaria}
        progresoPct={r.progresoPct}
        clienteId={clienteId}
        prestamoId={prestamo.id}
      />

      {/* Compromiso de pago + nota del cobrador, pegado al cartón para confirmarlo. */}
      {compromiso && <CompromisoCarton compromiso={compromiso} />}

      <RegistroCobro
        clienteId={clienteId}
        prestamoId={prestamo.id}
        clienteNombre={cliente?.nombre ?? ""}
        clienteTelefono={cliente?.telefono ?? null}
        cobradorNombre={cobradorNombre}
        cobradorId={cobradorId}
        cuota={prestamo.cuota_diaria}
        saldoActual={r.falta}
        tieneGps={tieneGps}
      />

      {/* Cobros recientes con "deshacer" dentro de 1 h (auto-corrección). */}
      <CobrosRecientes pagos={recientes} />

      {/* Compromiso de pago: el cliente promete pagar en una fecha (mini-CRM). */}
      <RegistrarCompromiso clienteId={clienteId} prestamoId={prestamo.id} cuota={prestamo.cuota_diaria} />
    </>
  );
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[18px] font-extrabold text-tinta tabular-nums">{valor}</span>
    </div>
  );
}

/** Compromiso de pago (mini-CRM) mostrado JUNTO al cartón, con la nota que dejó
 *  el cobrador/gestor, para confirmarlo de un vistazo. El estado se auto-verifica
 *  contra el libro de pagos (cumplido/incumplido/vence hoy/vigente). */
function CompromisoCarton({ compromiso }: { compromiso: Gestion }) {
  const estado = compromiso.estadoCompromiso;
  const tono =
    estado === "cumplido"
      ? { bg: "#E4F5EC", fg: "#157A50", txt: "Cumplido ✓" }
      : estado === "incumplido"
        ? { bg: "#FBE4E2", fg: "#C0392B", txt: "No cumplió" }
        : estado === "vence_hoy"
          ? { bg: "#FDF3E2", fg: "#B9770E", txt: "Vence hoy" }
          : { bg: "#EAF0FF", fg: "#1E47C8", txt: "Vigente" };
  const [y, m, d] = (compromiso.fechaCompromiso ?? "").split("-");
  const fechaCorta = y ? `${d}/${m}/${y.slice(2)}` : "";
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-[#E4E8F4] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-tinta">🤝 Compromiso de pago</span>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: tono.bg, color: tono.fg }}>
          {tono.txt}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[19px] font-black text-tinta tabular-nums">{UYU(compromiso.montoCompromiso ?? 0)}</span>
        {fechaCorta && <span className="text-[12.5px] font-medium text-gris">para el {fechaCorta}</span>}
      </div>
      {compromiso.resultado && (
        <p className="rounded-[10px] bg-suave px-3 py-2 text-[12.5px] font-medium text-[#3A445F]">
          📝 {compromiso.resultado}
        </p>
      )}
      <span className="text-[11px] font-medium text-gris">
        {compromiso.pagadoDesde > 0 ? `Abonó ${UYU(compromiso.pagadoDesde)} desde la promesa` : "Sin pagos desde la promesa"}
        {compromiso.gestorNombre ? ` · lo registró ${compromiso.gestorNombre}` : ""}
      </span>
    </div>
  );
}

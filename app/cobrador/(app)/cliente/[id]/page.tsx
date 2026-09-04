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
import { calcularEstadosCarton, plazoVencido } from "@/lib/cartones";
import { formatearSuerte } from "@/lib/quiniela";
import { hoyUY, fechaISOUY } from "@/lib/fecha";
import type { Prestamo } from "@/types/db";
import { montoRenovacionAutoAprobable, rotuloTechoPropio } from "@/lib/renovacion";
import {
  ROTULO_CUOTA,
  ROTULO_FRECUENCIA,
  UNIDAD_FRECUENCIA,
} from "@/lib/domain/credito";
import { getCorreccionesDeCreditos } from "@/lib/data/correcciones";
import { UYU, diasSemana, parseFecha } from "@/lib/format";
import { RegistroCobro } from "@/components/cobrador/RegistroCobro";
import { CartonCobrador } from "@/components/cobrador/CartonCobrador";
import { CobrosRecientes, type PagoReciente } from "@/components/cobrador/CobrosRecientes";
import { HistorialPagos, type PagoHistorial } from "@/components/cobrador/HistorialPagos";
import { HistorialCreditos } from "@/components/HistorialCreditos";
import { getHistorialCreditosCliente } from "@/lib/data/ficha";
import { RegistrarCompromiso } from "@/components/cobrador/RegistrarCompromiso";
import { BeaconFicha } from "@/components/cobrador/BeaconFicha";
import { NotasCliente } from "@/components/notas/NotasCliente";
import { AvisoAlta } from "@/components/cobrador/AvisoAlta";
import { estadoAlta } from "@/lib/data/acceso";

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
  const [usuario, cliente, activos, notas, historialCreditos] = await Promise.all([
    requireUsuario(),
    getClientePorId(db, id),
    getPrestamosActivosPorCliente(db, id),
    getNotasCliente(db, id),
    // Historial de créditos del cliente: cuántas veces renovó, si cada uno fue
    // renovación o venta nueva, quién lo colocó y en cuántos días lo pagó. Es lo
    // que el cobrador necesita ANTES de decidir si le suelta capital de nuevo —
    // hasta ahora esa decisión se tomaba a ciegas (ARACELI RANGER tardó 155 días
    // en un crédito de 35 y en pantalla se veía igual que uno pagado perfecto).
    getHistorialCreditosCliente(db, id),
  ]);
  if (!cliente) notFound();

  // Un cliente puede tener VARIOS créditos activos (0037), y algunos pueden ser
  // de OTRO cobrador (el cliente está en dos rutas: 59 casos hoy). El cobrador
  // elige a cuál imputa; por defecto, el más nuevo DE LOS SUYOS — nunca el del
  // compañero: ese default era el que hacía que abriera la ficha y cobrara sobre
  // el crédito ajeno sin tocar nada (la cuota se le descontaba al otro).
  const mios =
    usuario.rol === "cobrador"
      ? activos.filter((p) => !p.cobrador_id || p.cobrador_id === usuario.id)
      : activos;
  const ajenos = activos.filter((p) => !mios.includes(p));
  const prestamo = mios.find((p) => p.id === credito) ?? mios[0] ?? null;
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
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[16px] avatar-marca text-[22px] font-black text-white">
          {inicial}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[19px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="truncate text-[12.5px] font-medium text-gris">
            {cliente.direccion ?? "Sin dirección"}
          </span>
          {cliente.numero_registro != null && (
            <span className="mt-1 w-fit rounded-full bg-azul-suave px-2 py-0.5 text-[10.5px] font-bold text-azul tabular-nums">
              Registro N.º {cliente.numero_registro} · 🍀 {formatearSuerte(cliente.numero_registro)}
            </span>
          )}
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-shrink-0 items-center gap-1 rounded-full bg-azul-suave px-3 py-2 text-[12.5px] font-bold text-azul active:scale-95"
          >
            📍 Cómo llegar
          </a>
        )}
      </div>

      {/* ¿Ya tiene su link del cartón? Entrega del QR / WhatsApp (alta en la app). */}
      <AvisoAlta clienteId={id} estado={estadoAlta(cliente)} />

      {/* Los créditos que este cliente tiene con OTRO cobrador: se muestran para
          que sepa que la persona ya paga por otro lado (y no le exija de más),
          pero NO se pueden elegir ni cobrar — no son su plata ni su comisión. */}
      {ajenos.length > 0 && (
        <p className="rounded-[12px] border border-violeta-suave bg-violeta-suave px-3.5 py-2.5 text-[11.5px] font-semibold text-violeta-osc">
          Este cliente tiene {ajenos.length} crédito{ajenos.length === 1 ? "" : "s"} con otro cobrador
          {" "}({ajenos.map((p) => UYU(p.cuota_diaria)).join(" + ")} de cuota). Esa parte no la cobrás vos.
        </p>
      )}

      {/* Selector de crédito: solo si el cliente tiene MÁS DE UNO activo SUYO. */}
      {mios.length > 1 && prestamo && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-gris">
            {mios.length} créditos activos — elegí a cuál imputás:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {mios.map((p, i) => {
              const activo = p.id === prestamo.id;
              return (
                <Link
                  key={p.id}
                  href={`/cobrador/cliente/${id}?credito=${p.id}`}
                  scroll={false}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
                    activo
                      ? "bg-[#1E47C8] text-white"
                      : "border border-campo bg-tarjeta text-gris"
                  }`}
                >
                  {/* Monto + fecha de inicio: dos créditos de efectivo con igual
                      cuota eran indistinguibles ("Crédito 1 · $300/día"). Y "/día"
                      era falso para los 202 no-diarios. */}
                  {p.origen === "tienda" ? `🛒 ${p.producto_nombre ?? "Tienda"}` : `Crédito de ${UYU(p.monto_prestado)}`}
                  {" · "}cuota {UYU(p.cuota_diaria)}
                  {p.fecha_inicio ? ` · desde ${String(p.fecha_inicio).slice(8, 10)}/${String(p.fecha_inicio).slice(5, 7)}` : ""}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!prestamo ? (
        /* ⚠️ El PRIMER crédito ya NO se pide a la oficina (regla de Carlos, 08-13:
           "solo pide autorización cuando exige más del 20% de aumento" — y un
           primer crédito no tiene contra qué medir un aumento). El cobrador que
           acaba de censar a la persona que tiene ENFRENTE le da el crédito acá
           mismo, al 20% del negocio y con el CAP como único tope. Antes este
           bloque era un `PedirAyuda` que dejaba al cliente esperando días por un
           OK — 3 pedidos de primer crédito llevaban 2 días en la cola (09-08). */
        <div className="flex flex-col items-center gap-3 rounded-[14px] bg-tarjeta px-4 py-6 text-center">
          <p className="text-[13px] leading-[1.5] font-medium text-gris">
            {historialCreditos.length === 0 ? (
              <>
                Nunca tuvo un crédito. <b className="text-tinta">Podés darle su primero ahora
                mismo</b> — sale al 20% del negocio.
              </>
            ) : (
              <>
                Terminó sus créditos anteriores.
                <b className="text-tinta"> Podés darle uno ahora mismo.</b>
              </>
            )}
          </p>
          <Link
            href={`/cobrador/colocar?modo=venta&cliente=${id}`}
            className="min-h-11 w-full rounded-[12px] bg-[#1FA971] text-center text-[14px] font-extrabold leading-[44px] text-white active:scale-[0.99]"
          >
            {historialCreditos.length === 0 ? "💵 Darle su primer crédito" : "💵 Darle un crédito"}
          </Link>
        </div>
      ) : (
        <Detalle
          db={db}
          clienteId={id}
          cliente={cliente}
          prestamo={prestamo}
          // El comprobante que se comparte por WhatsApp muestra el APODO si el
          // cobrador se puso uno (0132): su nombre real no viaja a terceros.
          cobradorNombre={(usuario.apodo ?? "").trim() || usuario.nombre}
          cobradorId={usuario.id}
        />
      )}

      {/* Sus créditos anteriores. A nivel de PÁGINA a propósito: se ve también
          cuando NO tiene crédito activo, que es justo el momento en que hay que
          decidir una venta nueva y hasta ahora se decidía a ciegas. */}
      <HistorialCreditos creditos={historialCreditos} titulo="Sus créditos" />

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
  // La unidad REAL de este crédito. El cartón devuelve un elemento por CUOTA, no
  // por día: en un semanal, "4 de 17" son 4 SEMANAS. El cliente ya lo ve bien en
  // su teléfono ("Semana 4/17"); acá se leía "4 días" (783 créditos activos, el
  // 62,7% del capital en la calle).
  const unidad = UNIDAD_FRECUENCIA[prestamo.frecuencia];
  // El plazo ya se cumplió Y todavía debe: lo que sigue es recuperación, no
  // "ponerse al día". Si ya está saldado, el plazo cumplido no es noticia — son
  // 394 créditos que mostraban "🎉 Terminó de pagar" y "⏳ es recuperación" a la
  // vez (los zombies saldados sin finalizar).
  const plazoCumplido = plazoVencido(prestamo, hoyUY()) && r.falta >= 1;

  // ⚠️ EN PARALELO, no encadenadas: esta pantalla ya tuvo el problema de las
  // 250-370 consultas en serie, y ninguna de las dos depende de la otra.
  //  · gestiones  → el compromiso de pago abierto (mini-CRM), el más reciente
  //    con promesa gana.
  //  · correcciones → ¿la oficina le tocó los términos a este crédito? Se lee
  //    con service_role: la policy de `auditoria` es solo-gestores y con la
  //    sesión del cobrador la consulta devuelve cero filas SIN error, así que el
  //    chip no se vería nunca (y ningún test lo notaría).
  const [gestiones, correcciones] = await Promise.all([
    getGestionesCliente(db, clienteId),
    getCorreccionesDeCreditos([prestamo.id]),
  ]);
  const correccion = correcciones.get(prestamo.id) ?? null;
  const compromiso =
    gestiones.find((g) => g.montoCompromiso != null && g.fechaCompromiso != null) ?? null;

  // Cobros recientes (últimas 2 h) → permiten "deshacer" dentro de 1 h.
  const DOS_HORAS = 2 * 60 * 60 * 1000;
  const ahora = Date.now();
  const recientes: PagoReciente[] = pagos
    // SOLO trabajo de la app (origen null): los ajustes del empalme llevan el
    // registrado_por del cobrador real — si el import corre durante la jornada,
    // aparecían acá con "Deshacer" activo de UN tap (QA 08-05) y deshacer un
    // ajuste de reconciliación rompe el espejo con Disapp.
    .filter((p) => (p.origen ?? null) === null)
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
  // Cobrado HOY en la APP sobre este crédito (día UY): inicializa el candado
  // anti-doble-cobro del botón desde el SERVIDOR, no solo desde la cola offline.
  const hoyStr = fechaISOUY(new Date());
  const pagadoHoyServidor = pagos
    .filter((p) => (p.origen ?? null) === null && p.registrado_en && fechaISOUY(new Date(p.registrado_en)) === hoyStr)
    .reduce((s, p) => s + Number(p.monto), 0);
  const tieneGps = Boolean(cliente?.gps_lat != null && cliente?.gps_lng != null);
  const tonoAtraso = atrasados > 0 ? { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" } : { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" };

  return (
    <>
      {/* ⚠️ TERMINÓ DE PAGAR: las dos puertas, acá, donde el cobrador ya está
          parado con el cliente enfrente. Antes había que volver a la ruta, tocar
          "+", elegir un modo y buscarlo en una lista de 120 nombres — y el que no
          entraba en la lista simplemente no aparecía (reporte de campo 07-08).
            · Renovar     → repite el crédito TAL CUAL. Un toque, cero decisiones.
            · Nueva venta → el mismo momento, eligiendo monto y cuotas. */}
      {r.falta < 1 ? (
        <div className="flex flex-col gap-2 rounded-[16px] border border-verde-suave bg-verde-suave p-4">
          <span className="text-[14px] font-extrabold text-verde-osc">
            🎉 Terminó de pagar este crédito
          </span>
          <span className="text-[12.5px] leading-[1.45] font-medium text-verde-osc">
            Pagó {UYU(r.totalAPagar)} en {prestamo.total_dias} cuotas. Ya le podés dar uno nuevo.
          </span>
          <div className="mt-1 flex flex-col gap-2">
            <Link
              href={`/cobrador/colocar?modo=renovar&cliente=${clienteId}`}
              className="min-h-[52px] rounded-[12px] bg-[#1FA971] text-center text-[15px] font-extrabold leading-[52px] text-white active:scale-[0.99]"
            >
              🔁 Renovar igual · {UYU(prestamo.monto_prestado)}
            </Link>
            {/* El +20% a la VISTA (piloto 19-08: "no deja subir" = nadie sabía que
                podía ni hasta cuánto). Mismo número y MISMO rótulo que calcula el
                servidor (rotuloTechoPropio): un heredado de $120.000 no tiene
                margen propio y decirle "subilo hasta $120.000 (+20%)" era ofrecer
                el mismo número que ya tiene. */}
            <span className="text-center text-[12px] leading-[1.45] font-semibold text-gris">
              {rotuloTechoPropio(prestamo.monto_prestado, montoRenovacionAutoAprobable(prestamo.monto_prestado)) ? (
                <>
                  O subilo hasta <b className="text-tinta">{UYU(montoRenovacionAutoAprobable(prestamo.monto_prestado))}</b>{" "}
                  {rotuloTechoPropio(prestamo.monto_prestado, montoRenovacionAutoAprobable(prestamo.monto_prestado))} vos solo
                  — más, lo aprueba tu supervisor. En Renovar → «Cambiar monto, cuotas o formato».
                </>
              ) : (
                <>
                  ¿Quiere más plata? El aumento lo aprueba tu supervisor: en Renovar →
                  «Cambiar monto, cuotas o formato» le llega el pedido al toque.
                </>
              )}
            </span>
            <Link
              href={`/cobrador/colocar?modo=venta&cliente=${clienteId}`}
              className="min-h-11 rounded-[12px] border border-verde-suave bg-tarjeta text-center text-[13.5px] font-bold leading-[44px] text-verde-osc active:scale-[0.99]"
            >
              💵 Nueva venta · otro crédito aparte
            </Link>
          </div>
        </div>
      ) : (
        /* ⚠️ TODAVÍA ESTÁ PAGANDO — y aun así puede llevarse OTRO crédito (regla de
           Carlos, 07-08: varios créditos a la vez, sin necesidad de estar al día). El
           sistema lo bloqueaba ("Este cliente ya tiene un crédito. Renovalo cuando
           lo termine de pagar") y por eso el operador no podía hacer la venta.
           Se muestra la deuda viva al lado: la decisión es del cobrador, informada. */
        <Link
          href={`/cobrador/colocar?modo=venta&cliente=${clienteId}`}
          className="flex items-center justify-between gap-3 rounded-[14px] border border-campo bg-tarjeta px-4 py-3 active:scale-[0.99]"
        >
          <div className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-extrabold text-tinta">💵 Darle otro crédito</span>
            <span className="text-[11.5px] leading-[1.4] font-medium text-gris">
              Puede tener varios a la vez. Le falta {UYU(r.falta)} de este.
            </span>
          </div>
          <span aria-hidden className="text-[15px] font-bold text-azul">→</span>
        </Link>
      )}

      {/* Distintivo de VENTA de tienda: que el cobrador NO confunda el dinero
          (una compra financiada) con el crédito de efectivo del cliente. */}
      {prestamo.origen === "tienda" && (
        <div className="flex items-center gap-2 rounded-[12px] bg-azul-suave px-3.5 py-2.5 text-[13px] font-bold text-azul">
          <span className="text-[16px]">🛒</span>
          <span>Compra en la tienda{prestamo.producto_nombre ? `: ${prestamo.producto_nombre}` : ""}</span>
        </div>
      )}

      {/* ── LA TARJETA DEL CRÉDITO ──────────────────────────────────────────
          Lo que el cobrador dice en voz alta frente al cliente, junto y sin
          ambigüedad de unidades. Antes esto decía "Cuota diaria" y "Días
          cubiertos" en los CUATRO formatos, y el formato del crédito no
          aparecía en ninguna parte de la pantalla. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* El formato, explícito. En un no-diario va destacado: es el dato que
            cambia cuándo hay que volver. */}
        <span
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-extrabold ${
            prestamo.frecuencia === "diario"
              ? "bg-campo text-gris"
              : "bg-azul-suave text-azul"
          }`}
        >
          {ROTULO_FRECUENCIA[prestamo.frecuencia]}
        </span>
        {plazoCumplido && (
          <span className="rounded-full bg-ambar-suave px-2.5 py-1 text-[11.5px] font-extrabold text-ambar-osc">
            ⏳ Plazo cumplido · es recuperación
          </span>
        )}
        {correccion && (
          /* La corrección administrativa, visible. El cartón de estos créditos
             cambió de un día para otro y sin esto nadie podía explicar por qué. */
          <span className="rounded-full bg-azul-suave px-2.5 py-1 text-[11.5px] font-extrabold text-azul">
            ✎ La oficina {correccion.que} ({fechaCorta(correccion.cuando)})
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Resumen label={ROTULO_CUOTA[prestamo.frecuencia]} valor={UYU(prestamo.cuota_diaria)} />
        <Resumen label="Saldo" valor={UYU(r.falta)} />
        {/* "Cuotas pagadas 4/17" — la MISMA palabra que el comprobante que el
            cliente recibe por WhatsApp ("Cuotas: lleva 4 de 17").
            ⚠️ Dice CUOTAS, no la unidad de tiempo: "Días pagadas" y "Meses
            pagadas" no concuerdan en género, y son el 75% de la cartera. La
            unidad del formato ya la dice el chip de arriba y el rótulo de la
            cuota; acá lo que se cuenta son cuotas y así se llama. */}
        <Resumen label="Cuotas pagadas" valor={`${cubiertos}/${prestamo.total_dias}`} />
        <Resumen label="Total" valor={UYU(r.totalAPagar)} />
      </div>

      {/* El próximo vencimiento ya estaba calculado y se descartaba. En un
          diario es casi obvio (mañana); en los 783 no-diarios es EL dato: sin
          él el cobrador no sabe si hoy le toca a este cliente o no. */}
      {/* ⚠️ `r.proxima` es la próxima cuota FUTURA: por definición nunca es la de
          hoy (la de hoy ya está vencida o en curso). Rotularla "Próxima cuota" a
          secas hacía que la ficha dijera "Próxima cuota jue 17/9" arriba y
          "Cuota de hoy pendiente" tres centímetros abajo — el cobrador leía el
          17 y se iba sin cobrar. Se dice cuál es la de HOY cuando hay, y la
          siguiente se rotula como lo que es: la que viene DESPUÉS. */}
      {r.proxima ? (
        <div className="flex items-center justify-between rounded-[12px] bg-campo px-3.5 py-2">
          <span className="text-[12px] font-bold text-gris">
            {r.montoParaAlDia > 0 ? "Después de esta, vence" : "Próxima cuota"}
          </span>
          <span className="text-[12.5px] font-extrabold text-tinta">
            {cuandoVence(r.proxima.diasRestantes, r.proxima.fecha)} · {UYU(prestamo.cuota_diaria)}
          </span>
        </div>
      ) : plazoCumplido ? null : (
        <div className="flex items-center justify-between rounded-[12px] bg-campo px-3.5 py-2">
          <span className="text-[12px] font-bold text-gris">Próxima cuota</span>
          <span className="text-[12.5px] font-extrabold text-tinta">No quedan cuotas por vencer</span>
        </div>
      )}

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
        <div className="flex items-center gap-2 rounded-[14px] bg-verde-suave px-4 py-2.5">
          <span className="text-[14px]">✅</span>
          <span className="text-[12.5px] font-bold text-verde-osc">Está al día. Solo la cuota de hoy si corresponde.</span>
        </div>
      )}

      {/* Cartón real (con reflejo en vivo del cobro recién registrado). */}
      <CartonCobrador
        dias={r.dias}
        cuota={prestamo.cuota_diaria}
        progresoPct={Math.min(100, r.progresoPct)}
        clienteId={clienteId}
        prestamoId={prestamo.id}
      />

      {/* Compromiso de pago + nota del cobrador, pegado al cartón para confirmarlo. */}
      {compromiso && <CompromisoCarton compromiso={compromiso} />}

      <RegistroCobro
        // key POR CRÉDITO: al cambiar de crédito con ?credito= (misma ruta, soft
        // navigation) el componente conservaba TODO su estado — botón "Sí, cobrar"
        // armado, nCuotas del stepper y hoyCobrado del OTRO crédito. Un tap
        // cobraba N cuotas del crédito equivocado con confirmación ajena. El key
        // fuerza remount limpio (y la rehidratación re-deriva hoyCobrado del
        // crédito correcto desde la cola offline).
        key={prestamo.id}
        clienteId={clienteId}
        prestamoId={prestamo.id}
        clienteNombre={cliente?.nombre ?? ""}
        clienteTelefono={cliente?.telefono ?? null}
        cobradorNombre={cobradorNombre}
        cobradorId={cobradorId}
        cuota={prestamo.cuota_diaria}
        saldoActual={r.falta}
        tieneGps={tieneGps}
        cuotasCubiertas={cubiertos}
        totalCuotas={prestamo.total_dias}
        cuotasAtrasadas={atrasados}
        pagadoHoyServidor={pagadoHoyServidor}
      />

      {/* Cobros recientes con "deshacer" dentro de 1 h (auto-corrección). */}
      <CobrosRecientes pagos={recientes} />

      {/* Historial completo del crédito + "pedir corrección" de un cobro propio
          de un día anterior (lo avala el supervisor/admin — doble registro). */}
      <HistorialPagos
        pagos={pagos.map(
          (p): PagoHistorial => ({
            id: p.id,
            monto: Number(p.monto),
            registradoEn: p.registrado_en,
            diaCredito: p.dia_credito ?? null,
            esMio: p.registrado_por === cobradorId,
            origen: p.origen ?? null,
          }),
        )}
      />

      {/* Compromiso de pago: el cliente promete pagar en una fecha (mini-CRM). */}
      <RegistrarCompromiso clienteId={clienteId} prestamoId={prestamo.id} cuota={prestamo.cuota_diaria} />
    </>
  );
}

/** "Hoy" / "Mañana" / "El vie 12/9". `diasRestantes` SÍ son días de calendario
 *  (diferencia de fechas), a diferencia de las casillas del cartón. */
function cuandoVence(diasRestantes: number, fechaIso: string): string {
  if (diasRestantes <= 0) return "Hoy";
  if (diasRestantes === 1) return "Mañana";
  const f = parseFecha(fechaIso);
  const dia = diasSemana[f.getDay()]?.slice(0, 3) ?? "";
  return `${dia} ${f.getDate()}/${f.getMonth() + 1}`;
}

/** "2026-09-04" → "4/9". Para el chip de corrección, que no necesita el año. */
function fechaCorta(iso: string): string {
  const f = parseFecha(iso);
  return Number.isNaN(f.getTime()) ? iso : `${f.getDate()}/${f.getMonth() + 1}`;
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-tarjeta p-3.5 shadow-sm">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
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
      ? { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)", txt: "Cumplido ✓" }
      : estado === "incumplido"
        ? { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)", txt: "No cumplió" }
        : estado === "vence_hoy"
          ? { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", txt: "Vence hoy" }
          : { bg: "var(--color-azul-suave)", fg: "var(--color-azul)", txt: "Vigente" };
  const [y, m, d] = (compromiso.fechaCompromiso ?? "").split("-");
  const fechaCorta = y ? `${d}/${m}/${y.slice(2)}` : "";
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-borde bg-tarjeta p-3.5 shadow-sm">
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
        <p className="rounded-[12px] bg-suave px-3 py-2 text-[12.5px] font-medium text-cuerpo">
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

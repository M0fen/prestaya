// Ruta del día del cobrador: arqueo + lista de clientes asignados con su
// estado de hoy. Lee por RLS (solo los suyos). Tocar un cliente → detalle.
// La lista puede reordenarse por cercanía (client-side, ver ListaRuta).
import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getRutaCobrador } from "@/lib/data/ruta";
import { getBannerCobradorActivo } from "@/lib/data/bannerCobrador";
import { BannerEquipo } from "@/components/cobrador/BannerEquipo";
import { getEstadoJornada, getJornadasSinRendir } from "@/lib/data/rendicion";
import { getSolicitudesGastoCobrador } from "@/lib/data/solicitudesGasto";
import { getMisPedidos } from "@/lib/data/misPedidos";
import { MisPedidos } from "@/components/cobrador/MisPedidos";
import { getUsuarioActual } from "@/lib/auth";
import { conTimeout } from "@/lib/timeout";
import { hoyUY } from "@/lib/fecha";
import { UYU, meses, diasSemana } from "@/lib/format";
import { calcularComision } from "@/lib/comision";
import { ListaRuta, type ItemRutaVista } from "@/components/cobrador/ListaRuta";
import { PrecargarFichas } from "@/components/cobrador/PrecargarFichas";
import { GastosRuta } from "@/components/cobrador/GastosRuta";
import { CerrarJornada } from "@/components/cobrador/CerrarJornada";
import { BienvenidaCard } from "@/components/BienvenidaCard";
import { OnboardingDia1 } from "@/components/OnboardingDia1";
import { MenuColocar } from "@/components/cobrador/MenuColocar";
import { BannerMotivacion } from "@/components/cobrador/BannerMotivacion";
import { mensajeMotivacion } from "@/lib/motivacion";

export const dynamic = "force-dynamic";

// Tope GENEROSO (22s) del render server-side: un query lento de DB lanza → lo toma
// el error.tsx del cobrador ("Reintentar, tus cobros están a salvo"), no un skeleton
// eterno. (La señal del cobro en la calle la maneja el SW; esto es la DB del server.)
const TOPE_MS = 22_000;

export default async function RutaPage() {
  const db = await createSupabaseServer();
  // Tanda 1 (independientes): ruta + usuario + banner. Tanda 2 (necesita usuario):
  // jornada + gastos + zona. Antes eran ~6 round-trips en SERIE en la primera
  // pantalla que abre el cobrador en la calle (señal pobre) → ahora 2 latencias.
  // El usuario va PRIMERO porque su id acota la ruta a los créditos que son SUYOS
  // (un cliente compartido con otro cobrador no le suma la cuota del compañero).
  // `getUsuarioActual` está cacheado por request, así que no agrega round-trip.
  const usuario = await getUsuarioActual();
  const [{ items, arqueo }, banner] = await conTimeout(
    Promise.all([getRutaCobrador(db, new Date(), usuario?.id ?? null), getBannerCobradorActivo(db)]),
    TOPE_MS,
    "cobrador.ruta",
  );
  // El nombre de la zona se resuelve con el cliente ADMIN: la tabla `zonas` está
  // bloqueada por RLS para el cobrador (0 filas), y esto es solo una etiqueta.
  const [jornada, solicitudesGasto, zonaNombre, abiertas, misPedidos] = await conTimeout(
    Promise.all([
      usuario ? getEstadoJornada(db, usuario.id) : Promise.resolve(null),
      usuario ? getSolicitudesGastoCobrador(db, usuario.id) : Promise.resolve(null),
      usuario?.zona_id
        ? createSupabaseAdmin()
            .from("zonas")
            .select("nombre")
            .eq("id", usuario.zona_id)
            .maybeSingle()
            .then((r) => r.data?.nombre ?? null)
        : Promise.resolve<string | null>(null),
      // ¿Le quedaron jornadas sin rendir? La plata sigue en su bolsillo sin sello.
      // Barre los últimos 7 días: mirando solo AYER, a partir del segundo día el
      // cobrador dejaba de ver su propia deuda (12 personas, $1.559.559).
      usuario ? getJornadasSinRendir(db, [usuario.id], new Date(), 7) : Promise.resolve([]),
      // TODO lo que pidió (renovaciones, gastos, correcciones) con su estado, su
      // antigüedad y qué hacer con cada uno. Los tres circuitos eran mudos del lado
      // del que pide: así nació el crédito duplicado de JORGE, y así quedaron tres
      // pedidos de $48.000 esperando por créditos que ya estaban colocados.
      usuario ? getMisPedidos(usuario.id) : Promise.resolve([]),
    ]),
    TOPE_MS,
    "cobrador.jornada",
  );

  // Saludo personalizado (nombre + zona). Da identidad a la app del cobrador.
  const horaUY = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Montevideo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const saludo = horaUY < 12 ? "Buen día" : horaUY < 19 ? "Buenas tardes" : "Buenas noches";
  // Primer(os) nombre(s), con mayúscula inicial (los nombres vienen en MAYÚS).
  const primerNombre = (usuario?.nombre ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim() || "cobrador";
  const hoy = hoyUY(); // día calendario de Uruguay (no la TZ del server), como la ruta/arqueo
  const fechaLarga = `${diasSemana[hoy.getDay()]} ${hoy.getDate()} de ${meses[hoy.getMonth()]}`;

  const vista: ItemRutaVista[] = items.map((i) => ({
    id: i.cliente.id,
    nombre: i.cliente.nombre,
    direccion: i.cliente.direccion,
    documento: i.cliente.documento,
    cuota: i.cuota,
    estadoHoy: i.estadoHoy,
    pagadoHoy: i.pagadoHoy,
    lat: i.cliente.gps_lat,
    lng: i.cliente.gps_lng,
    calificacion: i.cliente.calificacion,
    plazoVencido: i.plazoVencido,
    recuperadoHoy: i.recuperadoHoy,
    orden: i.orden,
    sinCuotaHoy: i.sinCuotaHoy,
    atraso: i.atraso,
    // Para el cobro de un toque desde la lista: el crédito al que se imputa y
    // cuántos propios tiene (con más de uno el atajo no aparece).
    prestamoId: i.prestamoId,
    creditosPropios: i.creditosPropios,
    cuotaCredito: i.cuotaCredito,
  }));

  // Avance de la ruta: clientes "resueltos" hoy (cobrados + no-pago) sobre el
  // total con crédito. El abono parcial NO cuenta como resuelto (falta cubrir).
  const resueltos = arqueo.cobrados + arqueo.noPagos;
  const avancePct = arqueo.clientes > 0 ? Math.round((resueltos / arqueo.clientes) * 100) : 0;
  // % y "Falta" se miden sobre lo cobrado EN LA RUTA (cuotas en término), no sobre
  // el recaudado total (que incluye recuperaciones de deuda vieja) → si no, una
  // recuperación mostraría "Completo ✓" con cuotas de hoy aún sin cobrar.
  const cobroPct = arqueo.esperado > 0 ? Math.min(100, Math.round((arqueo.recaudadoRuta / arqueo.esperado) * 100)) : 0;
  const faltanVisitas = Math.max(0, arqueo.clientes - resueltos);
  // ATRASO todavía vivo en la ruta: la app lo calcula cliente por cliente (y cada
  // tarjeta lo muestra), pero no estaba sumado en ningún lado — así el cartel de
  // arriba cantaba "Completo ✓" con deuda vieja sin recuperar. Se mide sobre lo que
  // NO se recuperó hoy, no sobre el atraso bruto: lo ya cobrado no es atraso.
  const atrasoVivo = Math.max(0, arqueo.atrasoEsperado - arqueo.atrasoRecuperado);
  // "Mi día": la comisión que YA se ganó hoy (motivación: plata en SU bolsillo).
  // Base = recaudado autoritativo del servidor (sus pagos de hoy). Solo si tiene %.
  // `comision_pct` ya viene en la fila propia (getUsuarioActual → select *), así
  // que se usa directo, sin un 2º round-trip con el cliente admin.
  const comisionPct = Number(usuario?.comision_pct ?? 0);
  const recaudadoBase = jornada?.recaudado ?? arqueo.recaudado;
  const comisionHoy = comisionPct > 0 ? calcularComision(recaudadoBase, comisionPct) : 0;

  // El saludo de arriba: sale de SUS números de hoy, no de una frase pegada.
  // Es un experimento medible (cada variante tiene su clave y el botón lleva
  // `?d=b`): si en dos semanas no mueve los cobros registrados ni las jornadas
  // cerradas, se saca. Ver el encabezado de lib/motivacion.ts.
  const motivacion = mensajeMotivacion({
    nombre: primerNombre,
    clientes: arqueo.clientes,
    resueltos,
    esperado: arqueo.esperado,
    recaudadoRuta: arqueo.recaudadoRuta,
    atrasoVivo,
    comisionHoy,
    yaRendida: !!jornada?.yaRendida,
    horaUY,
  });

  // Gastos que el cobrador SOLICITÓ pero el admin todavía NO aprobó: no bajan el
  // "esperado" del cierre (la plata recién sale de caja al aprobar), pero si el
  // cobrador YA gastó ese efectivo, le saldría un faltante fantasma. Se le AVISA en
  // el cierre; NO se resta solo (para no debilitar el control anti-fuga).
  const gastosPendientes = (solicitudesGasto?.items ?? [])
    .filter((s) => s.estado === "pendiente")
    .reduce((acc, s) => acc + s.monto, 0);

  // Altas: clientes de la ruta que todavía NO recibieron el link de su cartón.
  // Sale de `items` (ya cargados) → sin query extra en la pantalla de la calle.
  const sinAlta = items.filter(
    (i) => !i.cliente.acceso_visto_en && !i.cliente.acceso_entregado_en,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Saludo personalizado (nombre + zona + fecha). */}
      <div className="flex flex-col gap-0.5 px-0.5">
        <span className="text-[19px] font-extrabold tracking-[-0.01em] text-tinta">
          {saludo}, {primerNombre} 👋
        </span>
        <span className="text-[12.5px] font-medium text-gris capitalize">
          {zonaNombre ? `${zonaNombre} · ` : ""}{fechaLarga}
        </span>
      </div>

      {/* ARRANQUE DÍA 1 (08-05): contraseña propia + instalar la app. SÍ O SÍ
          visible hasta completar los dos pasos (iPhone y Android). */}
      <OnboardingDia1 claveCambiada={usuario?.clave_cambiada_en != null} />

      {/* Bienvenida cálida (solo la 1ª vez, se puede cerrar). */}
      <BienvenidaCard
        id="cobrador"
        saludo={`¡Hola, ${primerNombre}! 👋`}
        titulo="Esta es tu ruta de hoy."
        cuerpo="Abajo tenés tus clientes y cuánto llevás cobrado. Tocá un cliente para registrar su pago: funciona aunque te quedes sin señal, y podés deshacerlo si te equivocaste."
        cta={{ href: "/cobrador/tutorial", texto: "Ver cómo se usa" }}
      />

      {/* Banner del equipo (aviso del admin), si hay uno activo. */}
      {banner && <BannerEquipo banner={banner} />}

      {/* El empujón del día, con SUS números. Va arriba del arqueo pero no le
          compite: lo primero que el cobrador tiene que ver sigue siendo su plata. */}
      <BannerMotivacion m={motivacion} />

      {/* Arqueo del día */}
      <section className="rounded-[18px] bg-[linear-gradient(155deg,#173063_0%,#0F1B3D_60%)] p-4 text-white shadow-[0_10px_24px_rgba(15,27,61,0.28)]">
        <div className="mb-2 flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-wide text-white/70 uppercase">
              Cobrado en tu ruta
            </span>
            {/* El número grande usa el recaudado AUTORITATIVO del servidor (por
                quién registró, `jornada.recaudado`) — el MISMO que el cierre te va a
                pedir entregar. Así el hero y la rendición nunca divergen, y un pago
                que SALDA un crédito hoy no desaparece del total. */}
            <span className="text-[27px] leading-tight font-black tabular-nums">
              {UYU(recaudadoBase)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            {/* Sin nada que venza hoy (domingo, o una ruta toda de semanales) el
                porcentaje daba 0% al lado de "Completo ✓": dos números que se
                contradicen en el mismo renglón. Si no hay meta, no hay porcentaje. */}
            {arqueo.esperado > 0 && (
              <span className="text-[12px] font-bold text-white/80 tabular-nums">{cobroPct}%</span>
            )}
            {/* Lo que FALTA cobrar (accionable) lidera sobre el esperado pasivo. */}
            {arqueo.esperado - arqueo.recaudadoRuta > 0 ? (
              <span className="text-[13px] font-bold tabular-nums text-[#F2C14E]">
                Falta {UYU(arqueo.esperado - arqueo.recaudadoRuta)}
              </span>
            ) : atrasoVivo > 0 ? (
              /* ⚠️ "Completo ✓" a secas era MENTIRA con la calle llena: la meta del
                 día son solo las cuotas que VENCEN hoy, y el atraso acumulado se
                 calculaba pero no se mostraba sumado en ningún lado. María
                 Artunduaga abre con meta $58.704 y atraso $131.940: apenas cubría
                 las cuotas del día veía la palomita verde y se iba. Las cuotas de
                 hoy sí están completas — se dice eso, y al lado lo que queda. */
              <span className="text-[13px] font-bold tabular-nums text-[#34E0A1]">
                Cuotas de hoy ✓
              </span>
            ) : (
              <span className="text-[12px] font-bold text-[#34E0A1]">Completo ✓</span>
            )}
            <span className="text-[10.5px] font-medium text-white/45">
              {atrasoVivo > 0 && arqueo.esperado - arqueo.recaudadoRuta <= 0
                ? `queda atraso ${UYU(atrasoVivo)}`
                : `de ${UYU(arqueo.esperado)}`}
            </span>
          </div>
        </div>
        {/* Progreso de cobro (recaudado / esperado). */}
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)]"
            style={{ width: `${cobroPct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Mini label="Cobrados" valor={`${arqueo.cobrados}/${arqueo.clientes}`} />
          <Mini label="Abonos" valor={String(arqueo.abonos)} tono={arqueo.abonos > 0 ? "#F2C14E" : undefined} />
          <Mini label="Pendientes" valor={String(arqueo.pendientes)} />
          <Mini label="No pago" valor={String(arqueo.noPagos)} tono={arqueo.noPagos > 0 ? "#F0A0A0" : undefined} />
        </div>
        {/* Comisión ganada hoy: la plata que YA es del cobrador (motivación). */}
        {comisionPct > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-[12px] bg-white/10 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white/75">
              💰 Llevás ganado hoy <span className="text-white/40">· {comisionPct}%</span>
            </span>
            <span className="text-[17px] font-black tabular-nums text-[#34E0A1]">{UYU(comisionHoy)}</span>
          </div>
        )}
      </section>

      {/* CAJA DIARIA del cobrador (decisión 08-05): el efectivo que lleva encima,
          siempre a la vista — no recién al cierre. Mismos números que la rendición
          (base de apertura + recaudado − gastos aprobados), así el cierre nunca
          lo sorprende. Los gastos pedidos y AÚN no aprobados se avisan aparte. */}
      {jornada && jornada.disponible && (
        <section className="rounded-[16px] border border-[#E4E8F4] bg-white p-4 shadow-sm">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[13px] font-extrabold text-tinta">💼 Tu caja de hoy</span>
            {jornada.yaRendida ? (
              <span className="rounded-full bg-[#E4F5EC] px-2.5 py-1 text-[10.5px] font-bold text-[#157A50]">
                Jornada rendida ✓
              </span>
            ) : (
              <span className="text-[16px] font-black text-tinta tabular-nums">
                {/* ⚠️ Mismo cálculo que el cierre, COLOCADO incluido: sin restarlo,
                    esta tarjeta decía $98.053 y el cierre —tres secciones más
                    abajo, en la misma pantalla— pedía $58.053. */}
                {UYU(
                  Math.max(
                    0,
                    jornada.base + jornada.recaudado - jornada.gastosHoy - jornada.colocado,
                  ),
                )}
              </span>
            )}
          </div>
          <div className={jornada.colocado > 0 ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-3 gap-2"}>
            <CajaDato label="Base recibida" valor={UYU(jornada.base)} />
            <CajaDato label="Cobrado" valor={UYU(jornada.recaudado)} tono="#157A50" />
            {jornada.colocado > 0 && (
              <CajaDato label="Colocaste" valor={`−${UYU(jornada.colocado)}`} tono="#6D4AC7" />
            )}
            <CajaDato label="Gastos" valor={jornada.gastosHoy > 0 ? `−${UYU(jornada.gastosHoy)}` : UYU(0)} tono={jornada.gastosHoy > 0 ? "#B9770E" : undefined} />
          </div>
          {!jornada.yaRendida && (
            <p className="mt-2 text-[11px] leading-[1.45] font-medium text-[#8A93AD]">
              Es lo que deberías tener encima ahora — y lo que el cierre te va a pedir entregar
              {jornada.base > 0 ? " (la base se devuelve)" : ""}.
              {jornada.colocado > 0 &&
                ` Los ${UYU(jornada.colocado)} que pusiste en la calle (${jornada.creditosColocados} ${jornada.creditosColocados === 1 ? "crédito" : "créditos"}) ya están descontados: no te los van a pedir.`}
              {/* Base $0 a la mañana: puede ser real o que el supervisor no la cargó
                  todavía — que el cobrador lo sepa ANTES de salir, no en el cierre. */}
              {jornada.base <= 0 &&
                " Si te dieron plata de arranque y acá dice $0, pedile a tu supervisor que cargue la base."}
              {gastosPendientes > 0 &&
                ` Tenés ${UYU(gastosPendientes)} en gastos pedidos sin aprobar: no se descuentan todavía.`}
            </p>
          )}
        </section>
      )}

      {/* ⚠️ TUS PEDIDOS, arriba de la ruta y pegado a la caja, porque son PLATA: una
          renovación aprobada ya se le descontó del efectivo que lleva encima, y si
          no la entrega el cierre le cuadra igual mientras el cliente empieza a pagar
          un crédito que nunca recibió. Los tres circuitos (renovación, gasto,
          corrección) eran mudos del lado del que pide. */}
      <MisPedidos pedidos={misPedidos} />

      {/* Campaña de ALTAS: aparece solo mientras queden clientes sin su cartón,
          y desaparece sola cuando están todos entregados. */}
      {sinAlta > 0 && (
        <Link
          href="/cobrador/altas"
          className="flex items-center gap-3 rounded-[14px] border border-[#DCE6FB] bg-white px-3.5 py-3 shadow-sm active:scale-[0.99]"
        >
          <span aria-hidden="true" className="text-[20px]">
            📱
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-extrabold text-tinta">
              {sinAlta === 1
                ? "1 cliente todavía no tiene su cartón"
                : `${sinAlta} clientes todavía no tienen su cartón`}
            </span>
            <span className="text-[11.5px] font-medium text-gris">
              Mostrales el código QR y lo ven en su teléfono
            </span>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#1E47C8] px-3 py-1.5 text-[12px] font-bold text-white">
            Ver
          </span>
        </Link>
      )}

      {/* `id` = ancla del botón "Ver mi ruta" del banner: lo lleva a la lista sin
          sacarlo de la pantalla en la que ya está. */}
      <div id="ruta" className="flex scroll-mt-4 items-center justify-between px-0.5">
        <div className="flex flex-col">
          <h1 className="text-[16px] font-extrabold text-tinta">Mi ruta de hoy</h1>
          {arqueo.clientes > 0 && (
            <span className="text-[11.5px] font-medium text-gris">
              {faltanVisitas > 0
                ? `Te faltan ${faltanVisitas} de ${arqueo.clientes} · ${avancePct}% de la ruta`
                : `Ruta completa 🎉 · ${arqueo.clientes} clientes`}
            </span>
          )}
        </div>
        {/* Antes iba directo a Censar; ahora abre las tres formas de sumar
            plata a la ruta: Renovar · Nueva venta · Censar (decisión 08-05). */}
        <MenuColocar />
      </div>

      {items.length === 0 ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          Todavía no tenés clientes asignados. Usá “+ Agregar” para censar a alguien nuevo.
        </p>
      ) : (
        <>
          <ListaRuta items={vista} cobradorId={usuario?.id ?? null} />
          {/* Pre-carga las fichas de la ruta con señal → se pueden abrir/cobrar offline. */}
          <PrecargarFichas ids={vista.map((v) => v.id)} />
        </>
      )}

      {/* AYER cobró y NO rindió: la plata de esa jornada sigue en su bolsillo sin
          sello de entrega. Se le recuerda apenas abre la app (la rendición de un día
          pasado ya no se puede crear acá → la entrega es en mano, con el supervisor). */}
      {/* ⚠️ Miraba SOLO ayer, así que a partir del segundo día el cobrador dejaba de
          ver su propia deuda: hoy le hablaba a 5 personas por $1.034.862 y le callaba
          a otras 12 que arrastran $1.559.559. Ahora barre los últimos días y lista
          cada jornada con su monto — y dice a dónde va esa plata, porque ya no es un
          callejón: el supervisor la puede registrar desde su pantalla. */}
      {abiertas.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#F0D9A8] bg-[#FEFBF3] px-4 py-3">
          <span className="text-[13px] font-extrabold text-[#9A6A0E]">
            ⚠️ {abiertas.length === 1
              ? "Te quedó una jornada sin rendir"
              : `Te quedaron ${abiertas.length} jornadas sin rendir`}
          </span>
          {abiertas.map((j) => (
            <div key={j.fecha} className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="text-[12.5px] font-semibold text-[#9A6A0E]">
                {j.fecha.slice(8, 10)}/{j.fecha.slice(5, 7)} · {j.cobros} cobro{j.cobros === 1 ? "" : "s"}
                {j.antiguedad > 1 ? ` · hace ${j.antiguedad} días` : ""}
              </span>
              <span className="text-[14px] font-black text-[#9A6A0E]">{UYU(j.esperado)}</span>
            </div>
          ))}
          <p className="text-[12px] leading-[1.45] font-medium text-[#9A6A0E]">
            Ese efectivo sigue sin sello de entrega. Dáselo a tu supervisor apenas lo veas: él
            lo registra desde su pantalla y queda a tu nombre.
          </p>
        </div>
      )}

      {/* Gastos de ruta: el cobrador SOLICITA; el admin aprueba (0057). */}
      {solicitudesGasto && !jornada?.yaRendida && <GastosRuta solicitudes={solicitudesGasto} />}

      {/* Cierre de jornada (rendición): esperado vs entregado.
          `id` = ancla del botón "Cerrar mi jornada" del banner. */}
      {jornada && (
        <div id="cierre" className="scroll-mt-4">
        <CerrarJornada
          recaudado={jornada.recaudado}
          cobrosCantidad={jornada.cobrosCantidad}
          gastosHoy={jornada.gastosHoy}
          gastosPendientes={gastosPendientes}
          base={jornada.base}
          colocado={jornada.colocado}
          creditosColocados={jornada.creditosColocados}
          yaRendida={jornada.yaRendida}
          disponible={jornada.disponible}
        />
        </div>
      )}
    </div>
  );
}

function CajaDato({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col rounded-[11px] bg-[#F6F8FD] px-2.5 py-2">
      <span className="text-[10px] font-semibold text-[#8A93AD]">{label}</span>
      <span className="text-[13.5px] font-extrabold tabular-nums" style={{ color: tono ?? "#0F1B3D" }}>
        {valor}
      </span>
    </div>
  );
}

function Mini({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col rounded-[11px] bg-white/10 px-2.5 py-2">
      <span className="text-[10px] font-semibold text-white/50">{label}</span>
      <span className="text-[14px] font-extrabold tabular-nums" style={tono ? { color: tono } : undefined}>
        {valor}
      </span>
    </div>
  );
}

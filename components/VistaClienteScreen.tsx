// Pantalla completa de la vista de cliente. Recibe una VistaCredito ya
// calculada y solo la pinta. La usan tanto el demo (app/page.tsx) como la
// ruta real por token (app/c/[token]/page.tsx): misma UI, distinto origen.
import type { VistaCredito } from "@/types/cartones";
import type { Anuncio, Calificacion } from "@/types/db";
import type { ProductoParaCliente } from "@/lib/data/tienda";
import { TiendaBanner } from "@/components/tienda/TiendaBanner";
import type { JuegoCliente as Juego } from "@/lib/juegoCliente";
import type { Juego as JuegoArcade } from "@/lib/juegos";
import type { AjustesJuegoVista } from "@/components/JuegoCliente";
import type { RecompensaEvaluada } from "@/lib/recompensas";
import type { SaldoEstrellas } from "@/lib/estrellas";
import { EstrellasCliente } from "@/components/estrellas/EstrellasCliente";
import { PromoCliente, type PromoData } from "@/components/promos/PromoCliente";
import { TemporadaBanner } from "@/components/gaming/TemporadaBanner";
import { Header } from "@/components/Header";
import { Saludo } from "@/components/Saludo";
import { Reputacion } from "@/components/Reputacion";
import { CreditoCompletado } from "@/components/CreditoCompletado";
import { Aliento } from "@/components/Aliento";
import { ResumenCard } from "@/components/ResumenCard";
import { PonerseAlDia } from "@/components/PonerseAlDia";
import { BannerCarrusel } from "@/components/BannerCarrusel";
import { RifaBanner, type RifaVista } from "@/components/RifaBanner";
import { ProximaCuota } from "@/components/ProximaCuota";
import { CartonDigital } from "@/components/CartonDigital";
import { GameSlot } from "@/components/GameSlot";
import { Historial } from "@/components/Historial";
import Link from "next/link";
import { ReportarDiscrepancia } from "@/components/ReportarDiscrepancia";
import { RecordatorioLink } from "@/components/RecordatorioLink";
import { Footer } from "@/components/Footer";

export function VistaClienteScreen({
  v,
  anuncios = [],
  hayTienda = false,
  productoDestacado = null,
  token = null,
  reputacion = null,
  estrellas = null,
  promo = null,
  umbralCaritas,
  juegoArcade = null,
  temporada = null,
  rifa = null,
  creditoSelector = null,
}: {
  v: VistaCredito;
  anuncios?: Anuncio[];
  /** ¿Hay productos activos? → muestra el botón "Ir a la tienda" (página aparte). */
  hayTienda?: boolean;
  /** Producto destacado (con precio resuelto para el cliente) → banner del cartón. */
  productoDestacado?: ProductoParaCliente | null;
  /** Rifa promocional a mostrarle a este cliente (o null). */
  rifa?: RifaVista | null;
  /** Selector de crédito (si el cliente tiene varios activos). Se pinta arriba. */
  creditoSelector?: React.ReactNode;
  /** Token del link: habilita el reporte de discrepancia (solo vista real). */
  token?: string | null;
  /** Reputación positiva del cliente (chips). */
  reputacion?: { calificacion: Calificacion; creditosPagados: number } | null;
  /** Estado de juego (nivel/racha/misiones). Si es null, no se muestra la zona. */
  juego?: Juego | null;
  /** Saldo de estrellas (recompensa real). Si es null, no se muestra. */
  estrellas?: SaldoEstrellas | null;
  /** Juegos promocionales (raspadita + quiniela). Si es null, no se muestran. */
  promo?: PromoData | null;
  /** Umbral de días de atraso para la carita roja (lo define el admin). */
  umbralCaritas?: number;
  /** Config de presentación del juego (mensajes/premio/misiones). */
  juegoAjustes?: AjustesJuegoVista;
  /** Juego arcade elegido por el admin. Si es null, no se muestra el slot. */
  juegoArcade?: JuegoArcade | null;
  /** Recompensas evaluadas contra el juego del cliente. */
  recompensas?: RecompensaEvaluada[];
  /** Temporada/evento del mes (si el admin lo encendió). */
  temporada?: { nombre: string; emoji: string; meta: number; premio: string } | null;
}) {
  // Bloque LÚDICO "Novedades" (arcade, temporada, estrellas) oculto por ahora
  // (flag único, reversible). Lo que el admin usa para COMUNICARSE con el cliente
  // —anuncios, raspadita/quiniela y RIFA— se muestra siempre que lo active (fuera
  // de este flag): así "activar" en el panel de verdad llega al cliente.
  const MOSTRAR_JUEGOS: boolean = false;
  const hayNovedades = Boolean(temporada || estrellas || juegoArcade);
  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
      <div className="flex w-full max-w-[440px] flex-col gap-3 bg-app px-[18px] pt-4 pb-8 shadow-[0_0_60px_rgba(15,27,61,0.08)]">
        <Header inicial={v.inicial} />
        <Saludo nombre={v.nombre} />

        {creditoSelector}

        {/* Mensaje de aliento arriba (framing positivo, ancla de identidad). */}
        <Aliento
          alDia={v.alDia}
          mensaje={v.mensajeAliento}
          mejorRacha={v.mejorRacha}
        />

        {/* Banner de bienvenida/novedades del prestamista: ARRIBA DE TODO, de lo
            PRIMERO que ve el cliente (rota solo si hay varios). Esa es la gracia. */}
        <BannerCarrusel anuncios={anuncios} />

        {reputacion && (
          <Reputacion
            calificacion={reputacion.calificacion}
            creditosPagados={reputacion.creditosPagados}
          />
        )}

        {v.creditoCompletado && <CreditoCompletado />}

        {/* Cartón completo, bien arriba. */}
        <CartonDigital
          dias={v.dias}
          diaActual={v.diaEnCurso}
          totalDias={v.totalDias}
          unidad={v.unidad}
        />

        {/* ── TUS NÚMEROS: saldo → cuánto falta → próxima → historial (todo CONTIGUO,
            sin cortarlo con estrellas/marketing en el medio) ── */}

        <ResumenCard
          estadoGeneral={v.estadoGeneral}
          estadoDotStyle={v.estadoDotStyle}
          falta={v.falta}
          totalAPagar={v.totalAPagar}
          barFillStyle={v.barFillStyle}
          totalPagado={v.totalPagado}
          progresoTexto={v.progresoTexto}
          montoPrestado={v.montoPrestado}
          diaActual={v.diaEnCurso}
          totalDias={v.totalDias}
          fechaFinLarga={v.fechaFinLarga}
          unidad={v.unidad}
        />

        {/* Cuánto pagar hoy para quedar al día. Solo si hace falta. */}
        {v.necesitaPonerseAlDia && <PonerseAlDia monto={v.montoParaAlDia} />}

        {/* Próxima cuota: solo si el crédito sigue abierto y hay una próxima
            (si no, la tarjeta quedaba vacía en un crédito ya completado). */}
        {!v.creditoCompletado && v.proxRelativo && (
          <ProximaCuota
            cuotaDiaria={v.cuotaDiaria}
            proxFechaLarga={v.proxFechaLarga}
            proxRelativo={v.proxRelativo}
          />
        )}

        {/* Raspadita + quiniela: JUSTO DEBAJO del cartón (sin dinero real). Visible. */}
        {promo && <PromoCliente promo={promo} token={token} />}

        {/* Rifa promocional: se muestra cuando el admin la activa y este cliente
            califica (soloMejores). Es COMUNICACIÓN al cliente, no un juego → visible
            aunque el bloque lúdico esté en pausa. */}
        {rifa && <RifaBanner rifa={rifa} />}

        {/* Historial de pagos (con % de la cuota cubierto + descuento). */}
        <Historial historial={v.historial} />

        {/* TIENDA: banner del producto destacado (si el admin lo marcó) + botón de
            entrada al catálogo. Como una extensión de Presta Ya. Solo con token. */}
        {productoDestacado && token && (
          <TiendaBanner producto={productoDestacado} token={token} />
        )}
        {hayTienda && token && (
          <Link
            href={`/c/${token}/tienda`}
            className="flex items-center gap-3 rounded-[18px] bg-[linear-gradient(135deg,#2453DC,#13308C)] px-4 py-3.5 text-white shadow-[0_8px_22px_rgba(19,48,140,0.24)] active:scale-[0.99]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-white/15 text-[24px]">🛍️</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15.5px] font-extrabold leading-tight">Ir a la tienda</span>
              <span className="text-[12.5px] font-medium text-white/85">Electrodomésticos y más, en cuotas cómodas</span>
            </span>
            <span className="text-[20px] font-black">›</span>
          </Link>
        )}

        {/* ── NOVEDADES: TODO lo promocional/lúdico agrupado, DESPUÉS del dinero ── */}
        {MOSTRAR_JUEGOS && hayNovedades && (
          <>
            <div className="mt-2 flex items-center gap-2 px-1">
              <span className="text-[11px] font-bold tracking-wide text-gris uppercase">Novedades</span>
              <span className="h-px flex-1 bg-linea" />
            </div>

            {/* Temporada/evento del mes (si el admin lo encendió). */}
            {temporada && (
              <TemporadaBanner
                nombre={temporada.nombre}
                emoji={temporada.emoji}
                meta={temporada.meta}
                premio={temporada.premio}
              />
            )}

            {/* Estrellas: recompensa real por pagar (5 pagos = 1 estrella). */}
            {estrellas && <EstrellasCliente saldo={estrellas} token={token} />}

            {/* Espacio de juegos: slot aislado. Solo si el admin lo dejó activo. */}
            {juegoArcade && <GameSlot juego={juegoArcade} />}
          </>
        )}

        {/* Reporte de discrepancia + recordatorio: solo con token (vista real). */}
        {token && <ReportarDiscrepancia token={token} />}
        {token && <RecordatorioLink token={token} />}

        <Footer negocio={v.negocio} />
      </div>
    </div>
  );
}

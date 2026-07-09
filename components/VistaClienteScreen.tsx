// Pantalla completa de la vista de cliente. Recibe una VistaCredito ya
// calculada y solo la pinta. La usan tanto el demo (app/page.tsx) como la
// ruta real por token (app/c/[token]/page.tsx): misma UI, distinto origen.
import type { VistaCredito } from "@/types/cartones";
import type { Anuncio, Calificacion } from "@/types/db";
import type { JuegoCliente as Juego } from "@/lib/juegoCliente";
import type { Juego as JuegoArcade } from "@/lib/juegos";
import type { AjustesJuegoVista } from "@/components/JuegoCliente";
import type { RecompensaEvaluada } from "@/lib/recompensas";
import type { SaldoEstrellas } from "@/lib/estrellas";
import { LineaComportamiento } from "@/components/comportamiento/LineaComportamiento";
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
import { ReportarDiscrepancia } from "@/components/ReportarDiscrepancia";
import { RecordatorioLink } from "@/components/RecordatorioLink";
import { Footer } from "@/components/Footer";

export function VistaClienteScreen({
  v,
  anuncios = [],
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

        {reputacion && (
          <Reputacion
            calificacion={reputacion.calificacion}
            creditosPagados={reputacion.creditosPagados}
          />
        )}

        {v.creditoCompletado && <CreditoCompletado />}

        {/* ── Zona principal: temporada → cómo venís → cartón → estrellas ── */}

        {/* Temporada/evento del mes (si el admin lo encendió). */}
        {temporada && (
          <TemporadaBanner
            nombre={temporada.nombre}
            emoji={temporada.emoji}
            meta={temporada.meta}
            premio={temporada.premio}
          />
        )}

        {/* Rifa promocional (si el admin la activó y este cliente califica). */}
        {rifa && <RifaBanner rifa={rifa} />}

        {/* Banner de anuncios, justo debajo de la temporada. Si no hay temporada,
            queda solo el banner. Si no hay anuncios, no ocupa espacio. */}
        <BannerCarrusel anuncios={anuncios} />

        {/* Cómo venís (caritas, derivadas del cartón; se lee de un vistazo). */}
        <LineaComportamiento dias={v.dias} umbral={umbralCaritas} />

        {/* Cartón completo, bien arriba. */}
        <CartonDigital
          dias={v.dias}
          diaActual={v.diaActual}
          totalDias={v.totalDias}
          unidad={v.unidad}
        />

        {/* Estrellas: recompensa real por pagar (5 pagos = 1 estrella). */}
        {estrellas && <EstrellasCliente saldo={estrellas} token={token} />}

        {/* ── Zona financiera: saldo → cuánto falta → próxima → historial ── */}

        <ResumenCard
          estadoGeneral={v.estadoGeneral}
          estadoDotStyle={v.estadoDotStyle}
          falta={v.falta}
          totalAPagar={v.totalAPagar}
          barFillStyle={v.barFillStyle}
          totalPagado={v.totalPagado}
          progresoTexto={v.progresoTexto}
          montoPrestado={v.montoPrestado}
          diaActual={v.diaActual}
          totalDias={v.totalDias}
          fechaFinLarga={v.fechaFinLarga}
          unidad={v.unidad}
        />

        {/* Cuánto pagar hoy para quedar al día. Solo si hace falta. */}
        {v.necesitaPonerseAlDia && <PonerseAlDia monto={v.montoParaAlDia} />}

        <ProximaCuota
          cuotaDiaria={v.cuotaDiaria}
          proxFechaLarga={v.proxFechaLarga}
          proxRelativo={v.proxRelativo}
        />

        {/* Historial de pagos (con % de la cuota cubierto + descuento). */}
        <Historial historial={v.historial} />

        {/* ── Extras (juegos promocionales + arcade) ── */}

        {/* Juegos promocionales (raspadita + quiniela). Sin dinero real. */}
        {promo && <PromoCliente promo={promo} token={token} />}

        {/* Espacio de juegos: slot aislado. Solo si el admin lo dejó activo. */}
        {juegoArcade && <GameSlot juego={juegoArcade} />}

        {/* Reporte de discrepancia + recordatorio: solo con token (vista real). */}
        {token && <ReportarDiscrepancia token={token} />}
        {token && <RecordatorioLink token={token} />}

        <Footer negocio={v.negocio} />
      </div>
    </div>
  );
}

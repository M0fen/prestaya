// Pantalla completa de la vista de cliente. Recibe una VistaCredito ya
// calculada y solo la pinta. La usan tanto el demo (app/page.tsx) como la
// ruta real por token (app/c/[token]/page.tsx): misma UI, distinto origen.
import type { VistaCredito } from "@/types/cartones";
import type { Anuncio, Calificacion } from "@/types/db";
import type { JuegoCliente as Juego } from "@/lib/juegoCliente";
import type { Juego as JuegoArcade } from "@/lib/juegos";
import type { AjustesJuegoVista } from "@/components/JuegoCliente";
import type { EstadoMascota } from "@/lib/mascota";
import type { RecompensaEvaluada } from "@/lib/recompensas";
import { MascotaTamagotchi } from "@/components/mascota/MascotaTamagotchi";
import { CofreRecompensas } from "@/components/gaming/CofreRecompensas";
import { TemporadaBanner } from "@/components/gaming/TemporadaBanner";
import { Header } from "@/components/Header";
import { Saludo } from "@/components/Saludo";
import { Reputacion } from "@/components/Reputacion";
import { JuegoCliente } from "@/components/JuegoCliente";
import { CreditoCompletado } from "@/components/CreditoCompletado";
import { Aliento } from "@/components/Aliento";
import { ResumenCard } from "@/components/ResumenCard";
import { PonerseAlDia } from "@/components/PonerseAlDia";
import { BannerCarrusel } from "@/components/BannerCarrusel";
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
  juego = null,
  mascotaInicial = null,
  juegoAjustes,
  juegoArcade = null,
  recompensas = [],
  temporada = null,
}: {
  v: VistaCredito;
  anuncios?: Anuncio[];
  /** Token del link: habilita el reporte de discrepancia (solo vista real). */
  token?: string | null;
  /** Reputación positiva del cliente (chips). */
  reputacion?: { calificacion: Calificacion; creditosPagados: number } | null;
  /** Estado de juego (nivel/racha/misiones). Si es null, no se muestra la zona. */
  juego?: Juego | null;
  /** Estado guardado de la mascota (o null: usa localStorage/defaults). */
  mascotaInicial?: EstadoMascota | null;
  /** Config de presentación del juego (mensajes/premio/misiones). */
  juegoAjustes?: AjustesJuegoVista;
  /** Juego arcade elegido por el admin. Si es null, no se muestra el slot. */
  juegoArcade?: JuegoArcade | null;
  /** Recompensas evaluadas contra el juego del cliente. */
  recompensas?: RecompensaEvaluada[];
  /** Temporada/evento del mes (si el admin lo encendió). */
  temporada?: { nombre: string; emoji: string; meta: number; premio: string } | null;
}) {
  const alDia = juego?.estadoRacha === "al_dia";
  return (
    <div className="flex min-h-screen justify-center bg-fondo text-tinta">
      <div className="flex w-full max-w-[440px] flex-col gap-[18px] bg-app px-[18px] pt-5 pb-10 shadow-[0_0_60px_rgba(15,27,61,0.08)]">
        <Header inicial={v.inicial} />
        <Saludo nombre={v.nombre} />

        {reputacion && (
          <Reputacion
            calificacion={reputacion.calificacion}
            creditosPagados={reputacion.creditosPagados}
          />
        )}

        {v.creditoCompletado && <CreditoCompletado />}

        {/* Temporada/evento del mes (si el admin lo encendió). */}
        {juego && temporada && (
          <TemporadaBanner
            nombre={temporada.nombre}
            emoji={temporada.emoji}
            meta={temporada.meta}
            premio={temporada.premio}
          />
        )}

        {/* Mascota tamagotchi: elegir, acariciar, peinar, jugar (tono amable).
            Crece con los pagos reales (etapa del nivel) y festeja si va al día. */}
        {juego && (
          <MascotaTamagotchi
            token={token}
            inicial={mascotaInicial}
            etapa={juego.nivel.etapa}
            alDia={alDia}
          />
        )}

        {/* Juego: nivel + racha + misiones + logros (augmenta, tono amable). */}
        {juego && <JuegoCliente juego={juego} ajustes={juegoAjustes} />}

        {/* Cofre de recompensas (premios reales por hitos de pago). */}
        {juego && <CofreRecompensas recompensas={recompensas} />}

        <Aliento
          alDia={v.alDia}
          mensaje={v.mensajeAliento}
          mejorRacha={v.mejorRacha}
        />

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
        />

        {/* Cuánto pagar hoy para quedar al día. Solo si hace falta. */}
        {v.necesitaPonerseAlDia && <PonerseAlDia monto={v.montoParaAlDia} />}

        {/* Carrusel de anuncios (admin/supervisor). Si no hay, no ocupa espacio. */}
        <BannerCarrusel anuncios={anuncios} />

        <ProximaCuota
          cuotaDiaria={v.cuotaDiaria}
          proxFechaLarga={v.proxFechaLarga}
          proxRelativo={v.proxRelativo}
        />

        <CartonDigital
          dias={v.dias}
          diaActual={v.diaActual}
          totalDias={v.totalDias}
        />

        {/* Espacio de juegos: slot aislado. Solo si el admin lo dejó activo. */}
        {juegoArcade && <GameSlot juego={juegoArcade} />}

        <Historial historial={v.historial} />

        {/* Reporte de discrepancia + recordatorio: solo con token (vista real). */}
        {token && <ReportarDiscrepancia token={token} />}
        {token && <RecordatorioLink token={token} />}

        <Footer negocio={v.negocio} />
      </div>
    </div>
  );
}

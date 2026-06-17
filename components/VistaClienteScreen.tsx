// Pantalla completa de la vista de cliente. Recibe una VistaCredito ya
// calculada y solo la pinta. La usan tanto el demo (app/page.tsx) como la
// ruta real por token (app/c/[token]/page.tsx): misma UI, distinto origen.
import type { VistaCredito } from "@/types/cartones";
import type { Anuncio, Calificacion } from "@/types/db";
import { Header } from "@/components/Header";
import { Saludo } from "@/components/Saludo";
import { Reputacion } from "@/components/Reputacion";
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
}: {
  v: VistaCredito;
  anuncios?: Anuncio[];
  /** Token del link: habilita el reporte de discrepancia (solo vista real). */
  token?: string | null;
  /** Reputación positiva del cliente (chips). */
  reputacion?: { calificacion: Calificacion; creditosPagados: number } | null;
}) {
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

        {/* Espacio de juegos: slot aislado, reemplazable cada mes. */}
        <GameSlot />

        <Historial historial={v.historial} />

        {/* Reporte de discrepancia + recordatorio: solo con token (vista real). */}
        {token && <ReportarDiscrepancia token={token} />}
        {token && <RecordatorioLink token={token} />}

        <Footer negocio={v.negocio} />
      </div>
    </div>
  );
}

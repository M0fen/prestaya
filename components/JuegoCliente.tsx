// Sección de JUEGO de la vista del cliente (augmenta, no reemplaza). Tono
// amable y legible: celebra el avance sin presionar. Deriva de los pagos reales.
import type { JuegoCliente as Juego } from "@/lib/juegoCliente";

const RACHA_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  al_dia: { label: "Al día", bg: "#E4F5EC", fg: "#157A50" },
  en_riesgo: { label: "Vas bien, no aflojes", bg: "#FDF0DC", fg: "#B9770E" },
  // Rojo SUAVE (no el de alarma): el mensaje es de aliento, no de reproche
  // (regla de tono de la vista cliente — es una deuda, no se culpabiliza).
  rota: { label: "Retomá tu racha", bg: "#FBE4E2", fg: "#E06A6A" },
};

export interface AjustesJuegoVista {
  mensajeBienvenida: string;
  premioMeta: string;
  mostrarMisiones: boolean;
}

export function JuegoCliente({
  juego,
  ajustes,
}: {
  juego: Juego;
  ajustes?: AjustesJuegoVista;
}) {
  const chip = RACHA_CHIP[juego.estadoRacha];
  const mostrarMisiones = ajustes?.mostrarMisiones ?? true;

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#E3EAFB] bg-[linear-gradient(180deg,#EEF3FF,#FFFFFF)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
          Tu progreso
        </span>
        <span
          className="rounded-full px-3 py-1 text-[12px] font-extrabold text-white"
          style={{ background: juego.nivel.color }}
        >
          Nivel {juego.nivel.nombre}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Barra de XP */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-tinta">
                {juego.nivelSiguiente
                  ? `Nivel ${juego.nivelSiguiente.nombre}`
                  : "¡Nivel máximo!"}
              </span>
              <span className="text-[12px] font-bold text-[#B8923F]">
                {juego.nivelSiguiente
                  ? `${juego.xpEnNivel}/${juego.xpParaSubir} XP`
                  : `${juego.xp} XP`}
              </span>
            </div>
            <div className="h-[10px] w-full overflow-hidden rounded-full bg-[#E6ECFA]">
              <div
                className="py-bar-fill h-full rounded-full bg-[linear-gradient(90deg,#E0B45F,#CBA14A)]"
                style={{ "--v": juego.progresoNivel } as React.CSSProperties}
              />
            </div>
          </div>

          {/* Racha + cuotas */}
          <div className="flex items-center gap-2">
            {juego.racha > 0 ? (
              <span className="flex items-baseline gap-1 text-[14px] font-extrabold text-tinta">
                🔥 {juego.racha}
                <span className="text-[11.5px] font-semibold text-gris">
                  días al hilo
                </span>
              </span>
            ) : juego.mejorRacha > 0 ? (
              <span className="text-[12.5px] font-bold text-gris">
                🔥 Tu récord: {juego.mejorRacha} · retomá hoy
              </span>
            ) : (
              <span className="text-[12.5px] font-bold text-gris">
                🌱 Empezá tu racha hoy
              </span>
            )}
            {juego.escudos > 0 && (
              <span className="text-[13px]" title={`${juego.escudos} escudo(s)`}>
                {"🛡️".repeat(juego.escudos)}
              </span>
            )}
            <span
              className="ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold"
              style={{ background: chip.bg, color: chip.fg }}
            >
              {chip.label}
            </span>
          </div>
        </div>
      </div>

      {/* Logros */}
      <div className="mt-3 flex justify-between">
        {juego.logros.map((l) => (
          <div key={l.id} className="flex flex-col items-center gap-1">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-[17px]"
              style={{
                background: l.desbloqueado ? "#FBF3DC" : "#EEF1F8",
                opacity: l.desbloqueado ? 1 : 0.55,
                filter: l.desbloqueado ? "none" : "grayscale(1)",
              }}
            >
              {l.desbloqueado ? l.emoji : "🔒"}
            </div>
            <span className="max-w-[60px] text-center text-[10px] leading-tight font-semibold text-gris">
              {l.nombre}
            </span>
          </div>
        ))}
      </div>

      {/* Misiones: juegos livianos con progreso (derivados de los pagos) */}
      {mostrarMisiones && (
        <div className="mt-3 flex flex-col gap-2">
          <span className="text-[11px] font-bold tracking-[0.03em] text-gris uppercase">
            Misiones
          </span>
          {juego.misiones.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2.5 rounded-[13px] bg-white/70 px-3 py-2"
            >
              <span className="text-[18px]">{m.completa ? "✅" : m.emoji}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-bold text-tinta">{m.titulo}</span>
                  <span className="text-[11px] font-semibold text-gris">{m.detalle}</span>
                </div>
                <div className="h-[7px] w-full overflow-hidden rounded-full bg-[#E6ECFA]">
                  <div
                    className="py-bar-fill h-full rounded-full"
                    style={
                      {
                        "--v": m.progreso,
                        background: m.completa
                          ? "linear-gradient(90deg,#2FB47C,#1FA971)"
                          : "linear-gradient(90deg,#5B84F0,#2453DC)",
                      } as React.CSSProperties
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {ajustes?.premioMeta && (
            <span className="px-1 text-[11px] font-medium text-[#8A6D1E]">
              🎁 Al completar la racha: {ajustes.premioMeta}
            </span>
          )}
        </div>
      )}

      {/* Aliento a subir de nivel (positivo, sin presión) */}
      {juego.nivelSiguiente && !juego.completo && (
        <div className="mt-3 flex items-center gap-2 rounded-[13px] bg-[#FBF3DC] px-3.5 py-2.5">
          <span className="text-[16px]">🏆</span>
          <span className="text-[12.5px] font-semibold text-[#8A6D1E]">
            A {juego.cuotasParaSubir} cuota{juego.cuotasParaSubir === 1 ? "" : "s"} de
            Nivel {juego.nivelSiguiente.nombre}: mejor tasa y más cupo.
          </span>
        </div>
      )}
    </section>
  );
}

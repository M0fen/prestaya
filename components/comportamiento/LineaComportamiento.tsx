// Línea de comportamiento del crédito (caritas). Reemplaza a la mascota en la
// vista de cliente. Muestra, de un vistazo: una carita general (cómo venís) +
// una línea del tiempo de las últimas cuotas con su carita. Derivado del cartón
// (lib/comportamiento.ts). Presentacional puro (server component). Tono amable.
import { comportamientoGeneral, caritasUltimas, UMBRAL_ROJA, type DiaMinimo } from "@/lib/comportamiento";

export function LineaComportamiento({
  dias,
  umbral = UMBRAL_ROJA,
}: {
  dias: DiaMinimo[];
  /** Días de atraso para pasar de naranja a roja (lo define el admin). */
  umbral?: number;
}) {
  if (!dias || dias.length === 0) return null;

  const g = comportamientoGeneral(dias, umbral);
  const linea = caritasUltimas(dias, 10);

  return (
    <section
      className="flex flex-col gap-3 rounded-[20px] border p-4"
      style={{ borderColor: `${g.color}33`, background: `${g.color}0F` }}
      aria-label="Cómo venís con tu crédito"
    >
      {/* Carita general + mensaje amable */}
      <div className="flex items-center gap-3">
        <span
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-[30px]"
          style={{ background: `${g.color}22` }}
          aria-hidden="true"
        >
          {g.carita}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[16px] font-extrabold" style={{ color: g.color }}>
            {g.titulo}
          </span>
          <span className="text-[13px] leading-[1.4] font-medium text-gris">{g.mensaje}</span>
        </div>
      </div>

      {/* Línea del tiempo de las últimas cuotas */}
      {linea.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {linea.map((c, i) => (
              <div
                key={c.dia}
                className="py-carita flex flex-col items-center gap-1"
                style={{ animationDelay: `${i * 45}ms` }}
                title={`Día ${c.dia}`}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[18px]"
                  style={{ background: `${c.color}22` }}
                  aria-hidden="true"
                >
                  {c.carita}
                </span>
                <span className="text-[9px] font-semibold text-[#AEB6CC] tabular-nums">
                  {c.dia}
                </span>
              </div>
            ))}
          </div>
          <span className="text-[10.5px] font-medium text-[#AEB6CC]">
            Tus últimas cuotas — de izquierda (antes) a derecha (hoy).
          </span>
        </div>
      )}
    </section>
  );
}

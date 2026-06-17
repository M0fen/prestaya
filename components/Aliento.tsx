// Mensaje de aliento positivo + racha. Framing psicológico: refuerza el
// avance/logro (nunca la culpa). Verde sutil cuando está al día; azul cuando
// hay pendientes (aliento, no reproche).
export function Aliento({
  alDia,
  mensaje,
  mejorRacha,
}: {
  alDia: boolean;
  mensaje: string;
  mejorRacha: number;
}) {
  const bg = alDia
    ? "linear-gradient(135deg,#E7F6EF,#DCF3E8)"
    : "linear-gradient(135deg,#EEF3FF,#E6EDFF)";
  const borde = alDia ? "#C7ECDA" : "#D9E2FB";
  const colorTexto = alDia ? "#157A50" : "#1E47C8";

  return (
    <section
      className="flex items-center justify-between gap-3 rounded-[16px] px-4 py-3"
      style={{ background: bg, border: `1px solid ${borde}` }}
    >
      <span
        className="text-[14px] font-bold tracking-[-0.01em]"
        style={{ color: colorTexto }}
      >
        {mensaje}
      </span>

      {mejorRacha >= 3 && (
        <span
          className="flex flex-shrink-0 items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[12px] font-extrabold whitespace-nowrap"
          style={{ color: colorTexto }}
          title="Tu mejor racha de días al día"
        >
          🔥 {mejorRacha} días
        </span>
      )}
    </section>
  );
}

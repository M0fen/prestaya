// "Así lo ve el cliente" para /admin/promos — snapshot fiel (no interactivo) de
// la quiniela y la raspadita en el cartón. Cierra el ciclo "configuro → veo cómo
// queda", igual que Rifa y Tienda. Valores de ejemplo (número 042); si hay una
// quiniela abierta, usa su título y premio reales.
export function PromosPreview({
  quinielaTitulo,
  quinielaPremio,
  hayRaspa,
}: {
  quinielaTitulo: string | null;
  quinielaPremio: string | null;
  hayRaspa: boolean;
}) {
  return (
    <div className="rounded-[16px] bg-[#EAEEF7] p-3">
      <span className="mb-2 block text-[10.5px] font-bold tracking-wide text-gris uppercase">
        Así lo ve el cliente
      </span>
      <div className="mx-auto flex max-w-[360px] flex-col gap-2.5">
        {/* Raspadita (teaser) */}
        {hayRaspa && (
          <div className="flex items-center gap-3 rounded-[16px] border border-[#E7D9A6] bg-[linear-gradient(135deg,#FFF9E9,#FFF3D0)] px-4 py-3">
            <span className="text-[26px]">🎟️</span>
            <div className="flex flex-col">
              <span className="text-[13.5px] font-extrabold text-[#8A6A1F]">¡Tenés una raspadita!</span>
              <span className="text-[11.5px] font-semibold text-[#A9852E]">Rascá y descubrí tu beneficio.</span>
            </div>
          </div>
        )}

        {/* Quiniela (tarjeta con el número de la suerte) */}
        <div className="rounded-[18px] border border-[#DCE3F4] bg-white p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[18px]">🍀</span>
            <span className="text-[15px] font-extrabold text-tinta">
              {quinielaTitulo || "Quiniela del mes"}
            </span>
          </div>
          <p className="mb-3 text-[12.5px] font-medium text-gris">
            Premio: {quinielaPremio || "un beneficio en tu próximo crédito"}
          </p>
          <div className="flex flex-col items-center gap-1 rounded-[14px] bg-[linear-gradient(135deg,#EEF3FF,#E4ECFF)] px-4 py-3">
            <span className="text-[11px] font-bold tracking-[0.09em] text-[#1E47C8] uppercase">
              Este es tu número de la suerte
            </span>
            <span className="text-[38px] leading-none font-black tracking-[0.08em] text-[#13308C] tabular-nums">
              042
            </span>
          </div>
          <div className="mt-2.5 rounded-[12px] bg-[#E7F7EF] px-3 py-2.5 text-center text-[13px] font-bold text-[#157A50]">
            ✓ Estás en el sorteo. ¡Mucha suerte! 🍀
          </div>
        </div>
      </div>
      {!hayRaspa && (
        <p className="mt-2 text-center text-[11px] font-medium text-tenue">
          Cargá premios de raspadita arriba para que también aparezca su tarjeta.
        </p>
      )}
    </div>
  );
}

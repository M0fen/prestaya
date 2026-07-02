// Banner de la TEMPORADA/evento del mes (vista de cliente). Lo enciende el admin
// desde la zona de juego: tema + meta colectiva + premio. Alienta a pagar en
// fecha para "sumar entre todos", en tono festivo y positivo.
export function TemporadaBanner({
  nombre,
  emoji,
  meta,
  premio,
}: {
  nombre: string;
  emoji: string;
  meta: number;
  premio: string;
}) {
  if (!nombre.trim()) return null;
  return (
    <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#2453DC,#13308C)] p-4 text-white">
      <div className="py-shine absolute inset-0" aria-hidden="true" />
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-white/15 text-[24px]">
          {emoji}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[10.5px] font-bold tracking-[0.14em] text-white/55 uppercase">
            Temporada
          </span>
          <span className="text-[15px] font-extrabold">{nombre}</span>
          <span className="text-[12px] font-medium text-white/80">
            Meta del mes: {meta}% de clientes al día · pagá en fecha y sumás 💪
          </span>
        </div>
      </div>
      {premio.trim() && (
        <div className="relative mt-2.5 flex items-center gap-2 rounded-[12px] bg-white/12 px-3 py-2">
          <span className="text-[15px]">🎁</span>
          <span className="text-[12.5px] font-semibold text-white/90">Si llegamos: {premio}</span>
        </div>
      )}
    </section>
  );
}

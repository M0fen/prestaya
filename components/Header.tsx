// Encabezado: logo + nombre de la app + avatar con la inicial del cliente.

export function Header({ inicial }: { inicial: string }) {
  return (
    <header className="flex items-center justify-between pt-1.5">
      <div className="flex items-center gap-[11px]">
        <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-[linear-gradient(145deg,#1E47C8,#13308C)] shadow-[0_6px_16px_rgba(30,71,200,0.32)]">
          <span className="text-[20px] font-black tracking-[-0.02em] text-white">
            P
          </span>
        </div>
        <div className="flex flex-col leading-[1.1]">
          <span className="text-[17px] font-extrabold tracking-[-0.02em] text-tinta">
            Presta Ya
          </span>
          <span className="text-[11px] font-semibold tracking-[0.01em] text-gris">
            Tu crédito diario
          </span>
        </div>
      </div>
      <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#DCE3F4] bg-[#E7ECF9]">
        <span className="text-[17px] font-extrabold text-azul">{inicial}</span>
      </div>
    </header>
  );
}

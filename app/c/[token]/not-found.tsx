// 404 amable cuando el token del link no corresponde a ningún cliente.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-fondo px-6 text-tinta">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-3 rounded-[22px] border border-[#ECEFF8] bg-white px-6 py-10 text-center shadow-[0_10px_26px_rgba(15,27,61,0.06)]">
        <div className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] bg-[linear-gradient(145deg,#1E47C8,#13308C)]">
          <span className="text-[22px] font-black text-white">P</span>
        </div>
        <h1 className="m-0 text-[19px] font-extrabold tracking-[-0.02em] text-tinta">
          Enlace no válido
        </h1>
        <p className="m-0 max-w-[280px] text-[13.5px] leading-[1.5] font-medium text-gris">
          Este enlace no corresponde a ningún cliente o ya no está disponible.
          Verificá el link o comunicate con tu oficina.
        </p>
      </div>
    </div>
  );
}

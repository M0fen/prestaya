// Skeleton de la tienda (cubre /tienda y /tienda/[id]): la vidriera se DIBUJA
// al instante mientras el servidor arma el catálogo — antes había hasta 22 s de
// página en blanco (barrida 15-08), que en un e-commerce es un cliente que se va.
export default function TiendaCargando() {
  return (
    <div className="flex min-h-screen justify-center overflow-x-clip bg-fondo">
      <div className="flex w-full max-w-[480px] flex-col gap-3 bg-[#EBEEF5] px-[18px] pb-12 md:max-w-[1240px] md:bg-transparent md:px-8">
        {/* Barra de marca */}
        <div className="-mx-[18px] flex flex-col gap-2.5 bg-[linear-gradient(135deg,#2453DC,#13308C)] px-[18px] pb-3 pt-3 md:-mx-8 md:px-8">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-[10px] bg-white/25" />
            <div className="h-4 w-36 rounded-full bg-white/25" />
          </div>
          <div className="h-11 w-full rounded-[12px] bg-white/90" />
        </div>
        {/* Hero */}
        <div className="h-[280px] animate-pulse rounded-[20px] bg-[linear-gradient(150deg,#2453DC,#13308C)] opacity-70" />
        {/* Accesos */}
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-[92px] animate-pulse rounded-[14px] bg-white" />
          ))}
        </div>
        {/* Grilla de productos */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[...Array(8)].map((_, k) => (
            <div key={k} className="animate-pulse overflow-hidden rounded-[12px] bg-white">
              <div className="aspect-square w-full bg-[#EDF1F9]" />
              <div className="flex flex-col gap-2 p-2.5">
                <div className="h-3 w-4/5 rounded-full bg-[#EDF1F9]" />
                <div className="h-4 w-1/2 rounded-full bg-[#EDF1F9]" />
                <div className="h-3 w-2/3 rounded-full bg-[#E7F3EC]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

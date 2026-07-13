// Primitivas de "skeleton" para las pantallas pesadas del panel. Se muestran vía
// loading.tsx mientras el server component trae los datos: la navegación se siente
// instantánea (velocidad percibida) porque el esqueleto ya dibuja la forma de la
// página. Tokens tema-aware (bg-linea) → funciona en claro y oscuro.

/** Bloque con latido, base de todos los esqueletos. Neutro del sitio (bg-linea,
 *  flipea en oscuro). La calidez es el TONO del mensaje, no el color. */
export function BloqueSkel({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[14px] bg-linea motion-reduce:animate-none ${className}`} />;
}

/** Línea amable arriba del skeleton: un punto de marca que late + un mensaje corto.
 *  Calidez por el tono, con el azul del sitio. */
export function LineaCalida({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-semibold text-azul">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-azul motion-reduce:animate-none" />
      {texto}
    </div>
  );
}

/** Fila de N tarjetas iguales (para grids de KPIs/tiles). */
export function GridSkel({ n = 3, alto = "h-16", cols = "grid-cols-3" }: { n?: number; alto?: string; cols?: string }) {
  return (
    <div className={`grid ${cols} gap-2.5`}>
      {Array.from({ length: n }).map((_, i) => (
        <BloqueSkel key={i} className={alto} />
      ))}
    </div>
  );
}

/** Encabezado típico: título + bajada. */
export function HeaderSkel() {
  return (
    <div className="flex flex-col gap-2">
      <BloqueSkel className="h-7 w-56" />
      <BloqueSkel className="h-4 w-72 max-w-full" />
    </div>
  );
}

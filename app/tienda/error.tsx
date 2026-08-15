"use client";
// Error REAL de la tienda pública (base caída, timeout): antes se disfrazaba de
// "Pronto vas a ver productos acá" — una vidriera vacía FALSA. Ahora dice la
// verdad y da la salida (patrón del proyecto: ningún error sin salida).
export default function TiendaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-fondo px-6">
      <div className="flex max-w-[340px] flex-col items-center gap-3 rounded-[18px] border border-[#ECEFF8] bg-white px-6 py-10 text-center shadow-[0_10px_30px_rgba(15,27,61,0.08)]">
        <span className="text-[40px]" aria-hidden>📡</span>
        <p className="text-[16px] font-extrabold text-tinta">No pudimos cargar la tienda</p>
        <p className="text-[13px] font-medium text-gris">
          Es un problema de conexión de nuestro lado, no tuyo. Los productos siguen ahí.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-1 rounded-full bg-[#1E47C8] px-6 py-3 text-[14.5px] font-extrabold text-white active:scale-[0.98]"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}

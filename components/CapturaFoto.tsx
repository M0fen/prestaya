"use client";
// Captura/selección de foto con COMPRESIÓN en el navegador (canvas) antes de
// subir: una foto de cámara pesa varios MB; la bajamos a ~900px JPEG para que el
// upload sea liviano y no falle. Reutilizable: emite el data URL comprimido; el
// padre decide si subirlo ya (ficha) o mandarlo con el alta (censo).
import { useRef, useState } from "react";

/** Comprime una imagen a un data URL JPEG (máx `max` px del lado mayor). */
export async function comprimirImagen(file: File, max = 900, calidad = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", calidad);
}

export function CapturaFoto({
  fotoUrlInicial = null,
  onDataUrl,
  etiqueta = "Foto",
  requerida = false,
}: {
  fotoUrlInicial?: string | null;
  onDataUrl: (dataUrl: string) => void;
  etiqueta?: string;
  requerida?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(fotoUrlInicial);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const elegir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOcupado(true);
    try {
      const dataUrl = await comprimirImagen(file);
      setPreview(dataUrl);
      onDataUrl(dataUrl);
    } catch {
      setError("No se pudo procesar la imagen. Probá otra.");
    } finally {
      setOcupado(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold text-gris">
        {etiqueta}
        {requerida && <span className="text-[#D64545]"> *</span>}
      </span>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-borde bg-suave">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Foto del cliente" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[24px] opacity-40" aria-hidden>📷</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
          className="rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-tinta disabled:opacity-60"
        >
          {ocupado ? "Procesando…" : preview ? "Cambiar foto" : "Tomar / subir foto"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={elegir}
          className="hidden"
        />
      </div>
      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
    </div>
  );
}

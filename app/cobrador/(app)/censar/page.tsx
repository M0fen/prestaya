"use client";
// Censo en calle: el cobrador da de alta un cliente nuevo (queda activo y
// asignado a él). Captura GPS de la casa para la geo-cerca futura.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relevarCliente } from "@/app/cobrador/(app)/actions";
import { CapturaFoto } from "@/components/CapturaFoto";

function pedirGps(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  });
}

export default function CensarPage() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number | null; lng: number | null } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);

  const capturarGps = async () => {
    setUbicando(true);
    const g = await pedirGps();
    setGps(g);
    setUbicando(false);
  };

  const enviar = (formData: FormData) =>
    start(async () => {
      setError(null);
      if (!foto) {
        setError("Sacale una foto al cliente para darlo de alta.");
        return;
      }
      const res = await relevarCliente({
        nombre: String(formData.get("nombre") ?? ""),
        documento: String(formData.get("documento") ?? "") || null,
        telefono: String(formData.get("telefono") ?? "") || null,
        direccion: String(formData.get("direccion") ?? "") || null,
        notas: String(formData.get("notas") ?? "") || null,
        gpsLat: gps?.lat ?? null,
        gpsLng: gps?.lng ?? null,
        fotoDataUrl: foto,
      });
      if (res.ok) router.push(`/cobrador/cliente/${res.id}`);
      else setError(res.error);
    });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Ruta
      </Link>
      <h1 className="text-[18px] font-extrabold text-tinta">Censar cliente</h1>

      <form action={enviar} className="flex flex-col gap-3">
        <CapturaFoto onDataUrl={setFoto} etiqueta="Foto del cliente" requerida />
        <Campo name="nombre" label="Nombre y apellido" required placeholder="Ej. Juan Pérez" />
        <Campo name="documento" label="Documento (cédula)" placeholder="1.234.567-8" inputMode="numeric" />
        <Campo name="telefono" label="Teléfono" placeholder="099 123 456" type="tel" inputMode="tel" />
        <Campo name="direccion" label="Dirección" placeholder="Calle y número" />

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-gris">Nota (opcional)</span>
          <textarea
            name="notas"
            rows={2}
            maxLength={500}
            className="resize-none rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[14px] outline-none focus:border-azul"
          />
        </label>

        <button
          type="button"
          onClick={capturarGps}
          className="flex items-center justify-between rounded-[12px] border border-[#DCE3F4] bg-white px-4 py-2.5 text-left"
        >
          <span className="flex flex-col">
            <span className="text-[13px] font-bold text-tinta">Ubicación de la casa</span>
            <span className="text-[11.5px] font-medium text-[#8A93AD]">
              {ubicando
                ? "Ubicando…"
                : gps?.lat
                  ? `✓ ${gps.lat.toFixed(5)}, ${gps.lng!.toFixed(5)}`
                  : "Tocá para capturar el GPS"}
            </span>
          </span>
          <span className="rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul">
            {gps?.lat ? "Recapturar" : "Capturar"}
          </span>
        </button>

        {error && (
          <span className="text-[12.5px] font-semibold text-[#C0392B]">{error}</span>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-azul px-5 py-3 text-[14px] font-bold text-white disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar cliente"}
        </button>
      </form>
    </div>
  );
}

function Campo({
  name,
  label,
  placeholder,
  required = false,
  type = "text",
  inputMode,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  // Abre el teclado adecuado en el celular (tel/numérico) al cargar en la calle.
  inputMode?: "text" | "tel" | "numeric";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-gris">{label}</span>
      <input
        name={name}
        type={type}
        inputMode={inputMode}
        required={required}
        placeholder={placeholder}
        className="min-h-11 rounded-[10px] border border-[#DCE3F4] px-3 py-2.5 text-[14px] outline-none focus:border-azul"
      />
    </label>
  );
}

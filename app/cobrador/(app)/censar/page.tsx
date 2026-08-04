"use client";
// Censo en calle: el cobrador da de alta un cliente nuevo (queda activo y
// asignado a él). Captura el GPS de la casa: es el ANCLA de la geo-cerca de TODOS
// los cobros futuros del cliente, así que se captura SOLA al abrir (antes era un
// botón manual y el camino más común dejaba el ancla en null) con su precisión.
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relevarCliente } from "@/app/cobrador/(app)/actions";
import { CapturaFoto } from "@/components/CapturaFoto";

type GpsEstado = "ok" | "denegado" | "timeout" | "sin_fix" | "no_soportado";
type FixGps = { lat: number | null; lng: number | null; precision: number | null; estado: GpsEstado };

// 0,0 en Uruguay (lat≈-34, lng≈-56) es SIEMPRE un fix roto — algunos chips Android
// baratos lo emiten. No sirve como ancla (pondría la casa en el Golfo de Guinea →
// toda geo-cerca futura daría "fuera de zona").
function gpsUtilizable(g: FixGps | null): g is FixGps & { lat: number; lng: number } {
  return (
    !!g && g.lat != null && g.lng != null && !(Math.abs(g.lat) < 0.5 && Math.abs(g.lng) < 0.5)
  );
}

// Fix GPS: lat/lng + precisión (accuracy en metros) + estado (para distinguir
// "denegó permiso" de "no hubo señal"). maximumAge bajo (8s) evita anclar un fix
// viejo capturado mientras el cobrador caminaba.
function pedirGps(): Promise<FixGps> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve({ lat: null, lng: null, precision: null, estado: "no_soportado" });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          estado: "ok",
        }),
      (err) =>
        resolve({
          lat: null,
          lng: null,
          precision: null,
          estado: err.code === 1 ? "denegado" : err.code === 3 ? "timeout" : "sin_fix",
        }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 8000 },
    );
  });
}

export default function CensarPage() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<FixGps | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  // Confirmación de alta SIN foto (opcional desde 08-05): el primer intento
  // avisa; el segundo guarda igual.
  const [sinFotoOk, setSinFotoOk] = useState(false);

  const capturarGps = async () => {
    setUbicando(true);
    setGps(await pedirGps());
    setUbicando(false);
  };

  // Auto-captura al abrir la pantalla (no depende de que el cobrador se acuerde de
  // tocar "Capturar"). Puede recapturar si la señal mejora.
  useEffect(() => {
    void capturarGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gpsOk = gpsUtilizable(gps);
  // El SERVER descarta el ancla si la precisión supera esto (lib/geo.ts: MAX_PRECISION_ANCLA_M).
  // El cliente DEBE usar el mismo umbral: si no, con señal urbana pobre (±150-500 m) la
  // pantalla decía "✓ Capturada" y "Guardar cliente" pero el server tiraba la ubicación a
  // null → el cliente quedaba sin geo-cerca y nadie se enteraba.
  const MAX_PRECISION_ANCLA_M = 120;
  const anclaUsable = gpsOk && gps.precision != null && gps.precision <= MAX_PRECISION_ANCLA_M;
  const precisionMala = anclaUsable && gps.precision! > 100; // usable pero conviene mejorar

  const enviar = (formData: FormData) =>
    start(async () => {
      setError(null);
      // Foto OPCIONAL (08-05): sin foto, el primer "Guardar" pide confirmar —
      // sigue siendo lo recomendado, pero un cliente que no quiere foto ya no
      // traba el alta.
      if (!foto && !sinFotoOk) {
        setSinFotoOk(true);
        return;
      }
      try {
        const res = await relevarCliente({
          nombre: String(formData.get("nombre") ?? ""),
          documento: String(formData.get("documento") ?? "") || null,
          telefono: String(formData.get("telefono") ?? "") || null,
          direccion: String(formData.get("direccion") ?? "") || null,
          notas: String(formData.get("notas") ?? "") || null,
          // Solo se manda el ancla si es utilizable (nunca 0,0/null y con precisión que el
          // server acepta): así lo que ve el cobrador coincide con lo que se guarda.
          gpsLat: anclaUsable ? gps.lat : null,
          gpsLng: anclaUsable ? gps.lng : null,
          gpsPrecision: anclaUsable ? gps.precision : null,
          fotoDataUrl: foto,
        });
        if (res.ok) {
          // Si la ficha ya existía (viene de Disapp) y estaba libre, el servidor
          // la sumó a la ruta en vez de rebotar. Se avisa para que el cobrador
          // entienda por qué no le pidió la foto de nuevo.
          router.push(`/cobrador/cliente/${res.id}${res.adoptado ? "?sumado=1" : ""}`);
        } else setError(res.error);
      } catch {
        // SIN SEÑAL (o error de red): el censo necesita conexión (sube la foto). NO
        // dejamos que el error suba al límite (perdería lo tipeado + la foto). Se
        // avisa y el formulario QUEDA intacto para reintentar cuando haya señal.
        setError("Parece que no tenés señal. El alta necesita conexión para subir la foto. Cuando tengas señal, tocá “Guardar” de nuevo — no cierres, no se perdió nada.");
      }
    });

  // Texto del estado del GPS (distingue denegó / falló / señal débil).
  const estadoTexto = ubicando
    ? "Ubicando…"
    : gps?.estado === "denegado"
      ? "Permiso denegado — activá la ubicación del teléfono"
      : gps?.estado === "no_soportado"
        ? "Este teléfono no da ubicación"
        : gps?.estado === "timeout" || gps?.estado === "sin_fix"
          ? "No se pudo ubicar — reintentá con señal / cielo abierto"
          : anclaUsable
            ? `✓ Ubicación capturada (±${Math.round(gps.precision!)} m)`
            : gpsOk
              ? `Señal muy débil (±${Math.round(gps.precision!)} m) — se guardará SIN ubicación`
              : "Tocá para capturar el GPS";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Ruta
      </Link>
      <h1 className="text-[18px] font-extrabold text-tinta">Censar cliente</h1>

      <form action={enviar} className="flex flex-col gap-3">
        <CapturaFoto onDataUrl={setFoto} etiqueta="Foto del cliente (recomendada)" />
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
            className="resize-none rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[16px] outline-none focus:border-azul"
          />
        </label>

        <button
          type="button"
          onClick={capturarGps}
          disabled={ubicando}
          className="flex items-center justify-between rounded-[12px] border border-[#DCE3F4] bg-white px-4 py-2.5 text-left disabled:opacity-70"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-bold text-tinta">Ubicación de la casa</span>
            <span
              className={`text-[11.5px] font-medium ${
                gps?.estado === "denegado" || gps?.estado === "timeout" || gps?.estado === "sin_fix"
                  ? "text-[#C0392B]"
                  : gpsOk
                    ? "text-[#157A50]"
                    : "text-[#8A93AD]"
              }`}
            >
              {estadoTexto}
            </span>
          </span>
          <span className="flex-shrink-0 rounded-full bg-[#EEF3FF] px-3 py-1.5 text-[12px] font-bold text-azul">
            {gpsOk ? "Recapturar" : "Reintentar"}
          </span>
        </button>

        {/* Señal débil: el ancla sirve pero conviene mejorarla (está a la vista). */}
        {precisionMala && (
          <span className="text-[11.5px] font-semibold text-[#B9770E]">
            Señal débil (±{Math.round(gps.precision!)} m). Acercate a la casa y recapturá para
            una mejor ubicación.
          </span>
        )}
        {/* Sin ubicación USABLE (denegó/falló, o precisión que el server descarta): se
            puede guardar igual, pero se avisa (la geo-cerca quedaría ciega) y el botón
            cambia a "sin ubicación". */}
        {!anclaUsable && !ubicando && gps && (
          <span className="text-[11.5px] font-medium text-[#8A93AD]">
            Sin ubicación no se podrá validar la geo-cerca de este cliente. Podés guardar
            igual, pero mejor acercate a la casa y recapturá con señal.
          </span>
        )}

        {error && <span className="text-[12.5px] font-semibold text-[#C0392B]">{error}</span>}

        {/* Confirmación de alta SIN foto: se puede, pero que sea a propósito. */}
        {!foto && sinFotoOk && (
          <span className="rounded-[10px] bg-[#FDF3E2] px-3 py-2.5 text-[12px] leading-[1.5] font-semibold text-[#9A6A0E]">
            ⚠️ Vas a dar de alta a este cliente <b>sin foto</b>. Se puede, pero la foto ayuda a
            identificarlo después. Tocá “Guardar” de nuevo para confirmar.
          </span>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-azul px-5 py-3 text-[14px] font-bold text-white disabled:opacity-60"
        >
          {pending
            ? "Guardando…"
            : !foto && sinFotoOk
              ? "Guardar sin foto (confirmar)"
              : anclaUsable
                ? "Guardar cliente"
                : "Guardar sin ubicación"}
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
        className="min-h-11 rounded-[10px] border border-[#DCE3F4] px-3 py-2.5 text-[16px] outline-none focus:border-azul"
      />
    </label>
  );
}

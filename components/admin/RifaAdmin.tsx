"use client";
// Configuración de la RIFA (admin): mensaje del banner, texto del premio, botón,
// foto del premio, a quién se muestra (todos / solo mejores) y encendido.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CapturaFoto } from "@/components/CapturaFoto";
import { RifaBanner } from "@/components/RifaBanner";
import { SelectorSegmento } from "@/components/admin/SelectorSegmento";
import { guardarRifa } from "@/lib/acciones/rifas";
import type { Rifa } from "@/lib/data/rifas";
import type { DefinicionSegmento } from "@/lib/segmentos";

const input =
  "rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[14px] text-tinta outline-none focus:border-azul";

export function RifaAdmin({ rifa, zonas = [] }: { rifa: Rifa | null; zonas?: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [titulo, setTitulo] = useState(rifa?.titulo ?? "Gran rifa de fin de mes");
  const [mensaje, setMensaje] = useState(rifa?.mensaje ?? "");
  const [premioTexto, setPremioTexto] = useState(rifa?.premioTexto ?? "");
  const [botonTexto, setBotonTexto] = useState(rifa?.botonTexto ?? "Ver premio");
  // Audiencia (0089): reemplaza el viejo "solo mejores". Si la rifa no tiene
  // segmento_def pero sí soloMejores, se inicializa con calificación excelente/bueno
  // (equivalente exacto) para no perder la config previa al migrar a la nueva UI.
  const [segmentoDef, setSegmentoDef] = useState<DefinicionSegmento | null>(
    rifa?.segmentoDef ?? (rifa?.soloMejores ? { calificaciones: ["excelente", "bueno"] } : null),
  );
  const [activo, setActivo] = useState(rifa?.activo ?? false);
  const [fotoDataUrl, setFotoDataUrl] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    setOk(false);
    const res = await guardarRifa({
      id: rifa?.id ?? null,
      titulo,
      mensaje,
      premioTexto: premioTexto || null,
      botonTexto,
      // segmento_def es la fuente de verdad de la audiencia; soloMejores queda superado.
      soloMejores: false,
      segmentoDef,
      activo,
      fotoDataUrl,
    });
    setOcupado(false);
    if (res.ok) {
      setOk(true);
      setFotoDataUrl(null);
      router.refresh();
    } else setError(res.error);
  };

  // Vista previa: usa la foto recién elegida o la ya guardada.
  const previewFoto = fotoDataUrl ?? rifa?.fotoUrl ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Formulario */}
        <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gris">Título</span>
            <input className={input} value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gris">Mensaje del banner</span>
            <textarea
              className={`${input} resize-none`}
              rows={3}
              maxLength={400}
              placeholder="Ej: ¡Por estar al día entrás en la rifa! Sorteamos el 30."
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gris">Texto del premio</span>
            <input
              className={input}
              value={premioTexto}
              maxLength={200}
              placeholder="Ej: Un televisor 32''"
              onChange={(e) => setPremioTexto(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-gris">Texto del botón</span>
            <input className={input} value={botonTexto} maxLength={30} onChange={(e) => setBotonTexto(e.target.value)} />
          </label>

          <CapturaFoto
            fotoUrlInicial={rifa?.fotoUrl ?? null}
            onDataUrl={setFotoDataUrl}
            etiqueta="Foto del premio"
          />

          <SelectorSegmento value={segmentoDef} onChange={setSegmentoDef} zonas={zonas} />

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            <span className="text-[13px] font-semibold text-tinta">Rifa activa (visible para los clientes)</span>
          </label>

          {error && <span className="text-[12px] font-semibold text-[#C0392B]">{error}</span>}
          {ok && <span className="text-[12px] font-semibold text-[#157A50]">✓ Rifa guardada.</span>}
          <button
            type="button"
            onClick={guardar}
            disabled={ocupado || !titulo.trim()}
            className="rounded-full bg-[#1FA971] px-5 py-2.5 text-[14px] font-extrabold text-white disabled:opacity-50"
          >
            {ocupado ? "Guardando…" : "Guardar rifa"}
          </button>
        </div>

        {/* Vista previa (como la ve el cliente) */}
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-bold text-gris uppercase tracking-wide">Vista previa</span>
          <div className="mx-auto w-full max-w-[360px]">
            <RifaBanner
              rifa={{ titulo, mensaje, premioTexto: premioTexto || null, botonTexto, fotoUrl: previewFoto }}
            />
          </div>
          {!activo && (
            <p className="text-center text-[11.5px] font-medium text-tenue">
              Está apagada: no se muestra hasta que la actives.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

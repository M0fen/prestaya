"use client";
// Selector de AUDIENCIA reusable (0089): define a QUÉ RANGO DE PERSONAS le aparece
// algo. Edita una DefinicionSegmento (lib/segmentos.ts) por dimensiones combinables:
// calificación + estado del crédito + zona. Lo consumen anuncios (y luego rifa/tienda/
// quiniela). Vacío = "Todos los clientes". Sin dependencias de datos: las zonas se
// inyectan por prop.
import type { DefinicionSegmento, EstadoCreditoSegmento } from "@/lib/segmentos";
import { describirSegmento } from "@/lib/segmentos";
import type { Calificacion } from "@/types/db";

const CALIFS: { v: Calificacion; label: string }[] = [
  { v: "excelente", label: "Excelente" },
  { v: "bueno", label: "Bueno" },
  { v: "regular", label: "Regular" },
  { v: "riesgo", label: "Riesgo" },
  { v: "nuevo", label: "Nuevo" },
];
const ESTADOS: { v: EstadoCreditoSegmento; label: string }[] = [
  { v: "todos", label: "Todos" },
  { v: "al_dia", label: "Al día" },
  { v: "con_pendientes", label: "Con pendientes" },
];

const chip = (on: boolean) =>
  `rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
    on ? "bg-azul text-white" : "border border-campo bg-tarjeta text-gris hover:bg-suave"
  }`;

/** Devuelve null si la lista quedó vacía (limpio para el jsonb). */
const norm = <T,>(arr: T[]): T[] | null => (arr.length ? arr : null);
const toggle = <T,>(arr: readonly T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export function SelectorSegmento({
  value,
  onChange,
  zonas = [],
  sinEstado = false,
}: {
  value: DefinicionSegmento | null;
  onChange: (def: DefinicionSegmento) => void;
  zonas?: { id: string; nombre: string }[];
  /** Oculta el "estado del crédito" (p. ej. en la tienda, donde no se calcula el
   *  cartón del cliente y la visibilidad se define por calificación/zona). */
  sinEstado?: boolean;
}) {
  const def: DefinicionSegmento = value ?? {};
  const cal = def.calificaciones ?? [];
  const zon = def.zonas ?? [];
  const estado = def.estadoCredito ?? "todos";
  const nombresZona = Object.fromEntries(zonas.map((z) => [z.id, z.nombre]));
  const emit = (patch: Partial<DefinicionSegmento>) => onChange({ ...def, ...patch });

  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-borde bg-suave p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-tinta">A quién le aparece</span>
        <span className="truncate text-[11px] font-semibold text-azul">
          {describirSegmento(def, { zonas: nombresZona })}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Calificación (vacío = cualquiera)</span>
        <div className="flex flex-wrap gap-1.5">
          {CALIFS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => emit({ calificaciones: norm(toggle(cal, c.v)) })}
              className={chip(cal.includes(c.v))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {!sinEstado && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Estado del crédito</span>
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS.map((e) => (
              <button
                key={e.v}
                type="button"
                onClick={() => emit({ estadoCredito: e.v })}
                className={chip(estado === e.v)}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {zonas.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Zona (vacío = todas)</span>
          <div className="flex flex-wrap gap-1.5">
            {zonas.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => emit({ zonas: norm(toggle(zon, z.id)) })}
                className={chip(zon.includes(z.id))}
              >
                {z.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

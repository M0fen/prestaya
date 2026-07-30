"use client";
// Bandeja de PROSPECTOS de la tienda pública (/tienda, 0111): gente que NO es
// cliente aún y dejó su contacto. El admin llama por WhatsApp y los mueve
// contactado → cerrado/descartado. Es lead de marketing (no dinero).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolverLeadPublico } from "@/lib/acciones/leadsPublicos";
import { linkWhatsApp } from "@/lib/telefono";
import type { LeadPublico, EstadoLeadPublico } from "@/lib/data/leadsPublicos";

const ETIQUETA: Record<EstadoLeadPublico, { label: string; bg: string; fg: string }> = {
  nuevo: { label: "Nuevo", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  contactado: { label: "Contactado", bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
  cerrado: { label: "Cerrado ✓", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  descartado: { label: "Descartado", bg: "var(--color-suave)", fg: "var(--color-gris)" },
};

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function ProspectosPublicos({ leads }: { leads: LeadPublico[] }) {
  const [verTodos, setVerTodos] = useState(false);
  // Por defecto: solo los que reclaman acción (nuevo / contactado).
  const visibles = verTodos ? leads : leads.filter((l) => l.estado === "nuevo" || l.estado === "contactado");
  const nuevos = leads.filter((l) => l.estado === "nuevo").length;

  if (leads.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">🌐 Prospectos de la tienda pública</span>
          <span className="text-[11.5px] font-medium text-gris">
            Gente que dejó su contacto en la tienda pública. Llamalos y sumalos como clientes.
          </span>
        </div>
        {nuevos > 0 && (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#E8A317] px-2 text-[11px] font-black text-[#0F1B3D]">{nuevos}</span>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {visibles.map((l) => (
          <Fila key={l.id} l={l} />
        ))}
      </ul>
      {leads.length > visibles.length && !verTodos && (
        <button type="button" onClick={() => setVerTodos(true)} className="self-start text-[12px] font-bold text-azul">
          Ver todos ({leads.length}) →
        </button>
      )}
    </section>
  );
}

function Fila({ l }: { l: LeadPublico }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const e = ETIQUETA[l.estado];
  const mover = (estado: EstadoLeadPublico) =>
    start(async () => {
      const r = await resolverLeadPublico({ id: l.id, estado });
      if (r.ok) router.refresh();
    });
  const cerrado = l.estado === "cerrado" || l.estado === "descartado";
  return (
    <li className="flex flex-col gap-2 rounded-[12px] border border-linea bg-suave p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-bold text-tinta">{l.nombre}</span>
          <span className="text-[11.5px] font-medium text-gris">
            📞 {l.telefono}{l.productoNombre ? ` · interesado en ${l.productoNombre}` : ""} · {cuando(l.creadoEn)}
          </span>
        </div>
        <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: e.bg, color: e.fg }}>{e.label}</span>
      </div>
      {!cerrado && (
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={linkWhatsApp(l.telefono, `Hola ${l.nombre}, te contacto de Presta Ya por tu interés en la tienda.`)} target="_blank" rel="noopener noreferrer"
            className="rounded-full bg-[#25D366] px-3 py-1.5 text-[11.5px] font-bold text-white">WhatsApp</a>
          {l.estado === "nuevo" && (
            <button type="button" disabled={pend} onClick={() => mover("contactado")} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-azul disabled:opacity-60">Marcar contactado</button>
          )}
          <button type="button" disabled={pend} onClick={() => mover("cerrado")} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-verde-osc disabled:opacity-60">Cerrado ✓</button>
          <button type="button" disabled={pend} onClick={() => mover("descartado")} className="rounded-full px-2.5 py-1.5 text-[11.5px] font-bold text-gris disabled:opacity-60">Descartar</button>
        </div>
      )}
    </li>
  );
}

"use client";
// Desempeño por PERSONA (cobrador) con filtros: período (últimos N días, re-consulta
// en el servidor vía ?dias=), zona y búsqueda por nombre (client-side sobre la lista
// ya cargada). Más columnas que antes: zona, ticket promedio, último cobro. Solo
// lectura (no toca plata). La usa el panel de estadísticas (solo admin).
import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { UYU } from "@/lib/format";

export interface CobradorDesempeno {
  cobradorId: string;
  nombre: string;
  zonaId: string | null;
  zonaNombre: string | null;
  creditosActivos: number;
  capital: number;
  recaudo: number;
  cobros: number;
  ticketPromedio: number;
  ultimoCobro: string | null;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DesempenoPanel({
  cobradores,
  zonas,
  dias,
}: {
  cobradores: CobradorDesempeno[];
  zonas: { id: string; nombre: string }[];
  dias: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [zona, setZona] = useState("");
  const [q, setQ] = useState("");

  const setDias = (v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set("dias", v);
    router.replace(`${pathname}?${p.toString()}`);
  };

  const filtrados = useMemo(() => {
    const term = sinAcentos(q);
    return cobradores.filter(
      (c) =>
        (!zona || c.zonaId === zona) &&
        (!term || sinAcentos(c.nombre).includes(term)),
    );
  }, [cobradores, zona, q]);

  // Totales de lo filtrado (para leer el subconjunto de un vistazo).
  const tot = filtrados.reduce(
    (a, c) => ({
      capital: a.capital + c.capital,
      recaudo: a.recaudo + c.recaudo,
      cobros: a.cobros + c.cobros,
      creditos: a.creditos + c.creditosActivos,
    }),
    { capital: 0, recaudo: 0, cobros: 0, creditos: 0 },
  );

  const sel = "rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[13px] outline-none focus:border-azul";

  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-extrabold text-tinta">Desempeño por persona</span>
        <span className="text-[11px] font-medium text-tenue">
          Recaudo del período elegido · cartera gestionada · ticket promedio. Filtrá por zona o buscá a alguien.
        </span>
      </div>

      {/* Filtros: período (server) + zona + búsqueda (cliente) */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-bold text-gris">Período</span>
          <select value={String(dias)} onChange={(e) => setDias(e.target.value)} className={sel}>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-bold text-gris">Zona</span>
          <select value={zona} onChange={(e) => setZona(e.target.value)} className={sel}>
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10.5px] font-bold text-gris">Buscar persona</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre del cobrador…"
            className={`${sel} w-full`}
          />
        </label>
      </div>

      {/* Resumen del subconjunto filtrado */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Mini k="Personas" v={String(filtrados.length)} />
        <Mini k="Recaudo" v={UYU(tot.recaudo)} tono="#157A50" />
        <Mini k="Cobros" v={String(tot.cobros)} />
        <Mini k="Cartera" v={UYU(tot.capital)} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-linea text-[10.5px] font-bold uppercase tracking-wide text-gris">
              <th className="px-2 py-2 text-left">Cobrador</th>
              <th className="px-2 py-2 text-left">Zona</th>
              <th className="px-2 py-2 text-center">Créd.</th>
              <th className="px-2 py-2 text-right">Cartera</th>
              <th className="px-2 py-2 text-right">Recaudo</th>
              <th className="px-2 py-2 text-center">Cobros</th>
              <th className="px-2 py-2 text-right">Ticket prom.</th>
              <th className="px-2 py-2 text-center">Últ. cobro</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-[12px] font-medium text-gris">
                  Nadie coincide con el filtro.
                </td>
              </tr>
            ) : (
              filtrados.map((c) => (
                <tr key={c.cobradorId} className="border-b border-[#F4F6FB]">
                  <td className="px-2 py-2 font-semibold text-tinta">{c.nombre}</td>
                  <td className="px-2 py-2 text-gris">{c.zonaNombre ?? "—"}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-cuerpo">{c.creditosActivos}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-cuerpo">{UYU(c.capital)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-[#157A50]">{UYU(c.recaudo)}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-gris">{c.cobros}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-cuerpo">{UYU(c.ticketPromedio)}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-gris">{fechaCorta(c.ultimoCobro)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Mini({ k, v, tono }: { k: string; v: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-borde bg-suave p-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</span>
      <span className="text-[15px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{v}</span>
    </div>
  );
}

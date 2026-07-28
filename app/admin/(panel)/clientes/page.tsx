// Lista de clientes (admin/supervisor), estilo Disapp: Ref · Vendedor · Cliente
// · #Créditos · Reportado · Dirección. Buscable por nombre/documento; filtro de
// Archivados; exportación CSV. Cada fila abre la ficha completa.
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getClientesListaAdmin } from "@/lib/data/clientes";
import { FichaRapidaBoton } from "@/components/admin/FichaRapida";
import type { Calificacion } from "@/types/db";

export const dynamic = "force-dynamic";

const LIMITE = 60;

const BANDA: Record<Calificacion, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  bueno: { label: "Bueno", bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
  regular: { label: "Regular", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  riesgo: { label: "Riesgo", bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  nuevo: { label: "Nuevo", bg: "var(--color-violeta-suave)", fg: "var(--color-violeta-osc)" },
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archivados?: string }>;
}) {
  const sp = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();
  const archivados = sp.archivados === "1";
  const q = (sp.q ?? "").trim() || null;
  const clientes = await getClientesListaAdmin(db, { q, archivados, limite: LIMITE });

  // Vista general (de los resultados mostrados): totales + distribución.
  const conCredito = clientes.filter((c) => c.creditosActivos > 0).length;
  const reportadosN = clientes.filter((c) => c.reportado).length;
  const porBanda = clientes.reduce<Record<string, number>>((acc, c) => {
    acc[c.calificacion] = (acc[c.calificacion] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Clientes</h1>
          <span className="text-[13px] font-medium text-gris">
            {archivados ? "Clientes archivados (inactivos)." : "Buscá y abrí la ficha completa."}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {/* El alta de clientes se hace en ruta (censo del cobrador) / oficina;
              no se ofrece desde el panel para no duplicar el flujo. */}
          <a
            href="/api/reportes/clientes"
            className="inline-flex items-center gap-1.5 rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-azul-claro hover:bg-suave"
          >
            ⬇️ Exportar CSV
          </a>
          <Link
            href={archivados ? "/admin/clientes" : "/admin/clientes?archivados=1"}
            className={`rounded-full px-4 py-2 text-[13px] font-bold ${
              archivados ? "bg-[#2453DC] text-white" : "border border-borde bg-tarjeta text-gris"
            }`}
          >
            {archivados ? "← Activos" : "Archivados"}
          </Link>
        </div>
      </div>

      {/* Búsqueda (GET, sin JS) */}
      <form method="get" className="flex gap-2 print:hidden">
        {archivados && <input type="hidden" name="archivados" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por nombre o documento…"
          className="flex-1 rounded-[12px] border border-borde bg-tarjeta px-3.5 py-2.5 text-[14px] outline-none focus:border-azul"
        />
        <button type="submit" className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white">
          Buscar
        </button>
      </form>

      {/* Vista general de los resultados (dinámica). */}
      {clientes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Resumen etiqueta="Mostrados" valor={clientes.length} />
          <Resumen etiqueta="Con crédito activo" valor={conCredito} acento="var(--color-verde-osc)" />
          <Resumen etiqueta="Reportados" valor={reportadosN} acento={reportadosN > 0 ? "var(--color-rojo-osc)" : undefined} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            {(Object.keys(BANDA) as Calificacion[])
              .filter((k) => porBanda[k])
              .map((k) => (
                <span
                  key={k}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums"
                  style={{ background: BANDA[k].bg, color: BANDA[k].fg }}
                >
                  {BANDA[k].label} {porBanda[k]}
                </span>
              ))}
          </div>
        </div>
      )}

      {clientes.length === 0 ? (
        <p className="rounded-[14px] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          {q ? `Sin resultados para "${q}".` : "No hay clientes."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-3 py-2.5 text-left">Ref</th>
                <th className="px-3 py-2.5 text-left">Cliente</th>
                <th className="px-3 py-2.5 text-left">Vendedor</th>
                <th className="px-3 py-2.5 text-left">Dirección</th>
                <th className="px-3 py-2.5 text-center">Créditos</th>
                <th className="px-3 py-2.5 text-center">Reportado</th>
                <th className="px-3 py-2.5 text-center">Calificación</th>
                <th className="px-3 py-2.5 text-center">Ver</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const banda = BANDA[c.calificacion] ?? BANDA.nuevo;
                return (
                  <tr key={c.id} className="border-b border-[#F4F6FB] hover:bg-suave">
                    <td className="px-3 py-2.5 font-mono text-[11px] text-tenue">{c.refDisapp ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/clientes/${c.id}`} className="flex flex-col">
                        <span className="font-bold text-azul">{c.nombre}</span>
                        <span className="text-[11px] text-tenue">{c.documento ?? "Sin documento"}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-cuerpo">{c.vendedor ?? "—"}</td>
                    <td className="px-3 py-2.5 text-cuerpo">{c.direccion ?? "—"}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold text-tinta">
                      {c.creditosActivos}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {c.reportado ? (
                        <span className="text-[11px] font-bold text-rojo-osc">Sí</span>
                      ) : (
                        <span className="text-[11px] font-bold text-tenue">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={{ background: banda.bg, color: banda.fg }}
                      >
                        {banda.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex justify-center">
                        <FichaRapidaBoton clienteId={c.id} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] font-medium text-tenue-2">
        Se muestran hasta {LIMITE} resultados. Afiná con el buscador para encontrar un cliente puntual.
      </p>
    </div>
  );
}

function Resumen({ etiqueta, valor, acento }: { etiqueta: string; valor: number; acento?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[12px] border border-borde bg-tarjeta px-3 py-2">
      <span className="text-[19px] font-extrabold tabular-nums" style={{ color: acento ?? "var(--color-tinta)" }}>
        {valor}
      </span>
      <span className="text-[11.5px] font-semibold text-gris">{etiqueta}</span>
    </div>
  );
}

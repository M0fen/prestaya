// Lista de clientes (admin/supervisor), buscable por nombre o documento.
// Cada uno abre su ficha completa (/admin/clientes/[id]).
import Link from "next/link";
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { buscarClientesAdmin } from "@/lib/data/clientes";
import type { Calificacion } from "@/types/db";

export const dynamic = "force-dynamic";

const BANDA: Record<Calificacion, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "#E4F5EC", fg: "#157A50" },
  bueno: { label: "Bueno", bg: "#EAF0FF", fg: "#1E47C8" },
  regular: { label: "Regular", bg: "#FDF3E2", fg: "#B9770E" },
  riesgo: { label: "Riesgo", bg: "#FBE4E2", fg: "#C0392B" },
  nuevo: { label: "Nuevo", bg: "#F2F0FA", fg: "#7A4DD6" },
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  await requireGestor();
  const db = await createSupabaseServer();
  const clientes = await buscarClientesAdmin(db, q ?? null);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Clientes</h1>
        <span className="text-[13px] font-medium text-gris">
          Buscá por nombre o documento y abrí la ficha completa.
        </span>
      </div>

      {/* Búsqueda (GET, sin JS) */}
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar cliente…"
          className="flex-1 rounded-[12px] border border-[#DCE3F4] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-azul"
        />
        <button
          type="submit"
          className="rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white"
        >
          Buscar
        </button>
      </form>

      {clientes.length === 0 ? (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          {q ? `Sin resultados para "${q}".` : "No hay clientes activos."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clientes.map((c) => {
            const banda = BANDA[c.calificacion] ?? BANDA.nuevo;
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/clientes/${c.id}`}
                  className="flex items-center gap-3 rounded-[14px] border border-[#E6EAF4] bg-white px-3.5 py-3 hover:bg-[#F7F9FD]"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#2453DC] text-[15px] font-black text-white">
                    {c.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14.5px] font-bold text-tinta">{c.nombre}</span>
                    <span className="truncate text-[12px] font-medium text-[#8A93AD]">
                      {c.documento ?? "Sin documento"} · {c.telefono ?? "Sin teléfono"}
                    </span>
                  </div>
                  <span
                    className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: banda.bg, color: banda.fg }}
                  >
                    {banda.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Padrón de la ruta (pestaña Clientes). Búsqueda por nombre/cédula/dirección/
//  teléfono + chips Con crédito / Sin crédito. Cada fila: nombre COMPLETO (dos
//  líneas si hace falta — acá no se corta a nadie), dirección, y acciones de un
//  toque: llamar y abrir la ficha.
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import { UYU } from "@/lib/format";
import { EstadoVacio } from "@/components/EstadoVacio";

export interface ClienteVista {
  id: string;
  nombre: string;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  calificacion: string | null;
  conCredito: boolean;
  /** Cuota del crédito activo (0 si no tiene). */
  cuota: number;
  plazoVencido: boolean;
  /** Lo censó un cobrador (vs. alta de oficina/import). */
  esDeCenso: boolean;
  /** Compartido: su crédito activo es de OTRO cobrador (esa parte no la cobrás vos). */
  creditoAjeno?: boolean;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Colores por calificación (los mismos de la ruta). */
const CALIF: Record<string, { bg: string; fg: string }> = {
  excelente: { bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  bueno: { bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
  regular: { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  riesgo: { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  nuevo: { bg: "var(--color-violeta-suave)", fg: "var(--color-violeta-osc)" },
};

type Filtro = "todos" | "con" | "sin";

export function ListaClientes({ clientes }: { clientes: ClienteVista[] }) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const conCredito = clientes.filter((c) => c.conCredito).length;
  const sinCredito = clientes.length - conCredito;

  const visibles = useMemo(() => {
    const t = norm(q);
    const dig = q.replace(/\D/g, "");
    return clientes
      .filter((c) => (filtro === "con" ? c.conCredito : filtro === "sin" ? !c.conCredito : true))
      .filter((c) => {
        if (!t) return true;
        return (
          norm(c.nombre).includes(t) ||
          norm(c.direccion ?? "").includes(t) ||
          (dig.length >= 3 &&
            ((c.documento ?? "").replace(/\D/g, "").includes(dig) ||
              (c.telefono ?? "").replace(/\D/g, "").includes(dig)))
        );
      });
  }, [clientes, q, filtro]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="text-[19px] font-extrabold text-tinta">Mis clientes</h1>
          <span className="text-[12px] font-medium text-gris tabular-nums">
            {clientes.length} en tu ruta · {conCredito} con crédito
          </span>
        </div>
        <Link
          href="/cobrador/censar"
          className="min-h-11 flex-shrink-0 rounded-full bg-[#1E47C8] px-4 text-[13px] font-extrabold leading-[44px] text-white active:scale-95"
        >
          + Censar
        </Link>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Nombre, cédula, dirección o teléfono…"
        className="w-full rounded-[12px] border border-borde bg-tarjeta px-3.5 py-3 text-[16px] outline-none focus:border-azul"
      />

      <div className="flex gap-2">
        {(
          [
            { id: "todos", label: `Todos (${clientes.length})` },
            { id: "con", label: `Con crédito (${conCredito})` },
            { id: "sin", label: `Sin crédito (${sinCredito})` },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${
              filtro === f.id ? "bg-[#1E47C8] text-white" : "border border-borde bg-tarjeta text-gris"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 && (
        <EstadoVacio
          icono="user"
          titulo={q ? `Nadie con “${q}” en tu ruta` : filtro === "sin" ? "Todos con crédito" : "Tu ruta arranca vacía"}
          texto={
            q
              ? "Probá con el apellido o la cédula. Si la persona todavía no está en el sistema, censala con el botón de arriba."
              : filtro === "sin"
                ? "Todos tus clientes tienen crédito activo. Los que terminan de pagar aparecen acá."
                : "Censá al primero con el botón de arriba y le das su crédito en el momento."
          }
        />
      )}

      {visibles.map((c) => {
        const calif = c.calificacion ? CALIF[c.calificacion] : null;
        return (
          <div
            key={c.id}
            className="flex items-center gap-2 rounded-[16px] bg-tarjeta py-2.5 pr-2 pl-3.5 shadow-sm"
          >
            <Link
              href={`/cobrador/cliente/${c.id}`}
              className="flex min-w-0 flex-1 items-center gap-3 active:scale-[0.99]"
            >
              <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[12px] avatar-marca text-[16px] font-black text-white">
                {(c.nombre.trim().charAt(0) || "—").toUpperCase()}
                {calif && (
                  <span
                    className="absolute -right-1 -bottom-1 h-3.5 w-3.5 rounded-full border-2 border-white"
                    style={{ background: calif.fg }}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* El nombre COMPLETO: hasta dos líneas, nunca cortado a puntos. */}
                <span className="line-clamp-3 text-[14.5px] leading-[1.25] font-bold break-words text-tinta">
                  {c.nombre}
                </span>
                <span className="truncate text-[11.5px] font-medium text-tenue">
                  {c.direccion ?? "Sin dirección"}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {c.conCredito ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                      style={
                        c.creditoAjeno
                          ? { background: "var(--color-violeta-suave)", color: "var(--color-violeta-osc)" }
                          : c.plazoVencido
                            ? { background: "var(--color-ambar-suave)", color: "var(--color-ambar-osc)" }
                            : { background: "var(--color-verde-suave)", color: "var(--color-verde-osc)" }
                      }
                    >
                      {c.creditoAjeno
                        ? "Crédito de un compañero"
                        : c.plazoVencido
                          ? "Vencido · a recuperar"
                          : `Crédito · cuota ${UYU(c.cuota)}`}
                    </span>
                  ) : (
                    <span className="rounded-full bg-violeta-suave px-2 py-0.5 text-[10px] font-bold text-violeta-osc">
                      Sin crédito · se le puede vender
                    </span>
                  )}
                  {c.esDeCenso && (
                    <span className="rounded-full bg-azul-suave px-2 py-0.5 text-[10px] font-bold text-azul">
                      Censado
                    </span>
                  )}
                </span>
              </div>
            </Link>
            {c.telefono && (
              <a
                href={`tel:${c.telefono.replace(/[^\d+]/g, "")}`}
                aria-label={`Llamar a ${c.nombre}`}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-azul-suave text-[17px] active:scale-95"
              >
                📞
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

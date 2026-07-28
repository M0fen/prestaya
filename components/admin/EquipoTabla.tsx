"use client";
// Tabla de vendedores estilo Disapp (captura 2). Cada fila abre el modal de
// Detalle (captura 7). El buscador es GET (lo maneja la página server); acá solo
// el estado del modal abierto.
import { useState } from "react";
import type { MiembroEquipo } from "@/types/equipo";
import type { Rol } from "@/types/db";
import { DetalleVendedor } from "./DetalleVendedor";

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha ilegible → "—" (evita "Invalid Date")
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
}

export function EquipoTabla({
  miembros,
  viewerRol,
}: {
  miembros: MiembroEquipo[];
  /** Rol del que mira: define si puede restablecer accesos (server-side manda). */
  viewerRol?: Rol;
}) {
  const [sel, setSel] = useState<MiembroEquipo | null>(null);

  // admin → puede resetear a cualquiera; supervisor → solo a cobradores (que la
  // RLS ya acota a su zona). El servidor revalida igual.
  const puedeResetear = (m: MiembroEquipo) =>
    viewerRol === "admin" || (viewerRol === "supervisor" && m.rol === "cobrador");

  return (
    <>
      <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
        {/* min-w: 10 columnas → en mobile scrollea horizontal en vez de triturarse. */}
        <table className="w-full min-w-[880px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
              <th className="px-3 py-2.5 text-left">Ref</th>
              <th className="px-3 py-2.5 text-left">Ruta</th>
              <th className="px-3 py-2.5 text-left">Nombre</th>
              <th className="px-3 py-2.5 text-left">Email</th>
              <th className="px-3 py-2.5 text-left">Documento</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-3 py-2.5 text-left">Creado</th>
              <th className="px-3 py-2.5 text-center">Conectado</th>
              <th className="px-3 py-2.5 text-left">Último acceso</th>
              <th className="px-3 py-2.5 text-center">Disp.</th>
            </tr>
          </thead>
          <tbody>
            {miembros.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-[13px] font-medium text-gris">
                  Sin vendedores.
                </td>
              </tr>
            ) : (
              miembros.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => setSel(m)}
                  className="cursor-pointer border-b border-[#F4F6FB] hover:bg-suave"
                >
                  <td className="px-3 py-2.5 font-mono text-[11px] text-tenue">{m.refDisapp ?? "—"}</td>
                  <td className="px-3 py-2.5 text-cuerpo">{m.ruta ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-bold text-tinta">{m.nombre}</span>
                      <span className="text-[10.5px] font-semibold text-tenue uppercase">
                        {m.esDev ? "Desarrollador" : m.rol}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-cuerpo">{m.email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-cuerpo">{m.documento ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    {m.activo ? (
                      <span className="text-[11px] font-bold text-[#157A50]">Activo</span>
                    ) : (
                      <span className="text-[11px] font-bold text-tenue">Inactivo</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] text-tenue">{fechaCorta(m.creadoEnIso)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: m.conectado ? "#1FA971" : "#D0D5E2" }}
                      title={m.conectado ? "Conectado (últimas 24 h)" : "Desconectado"}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] text-tenue">{fechaCorta(m.ultimoAccesoIso)}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-cuerpo">{m.dispositivos}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sel && (
        <DetalleVendedor m={sel} onClose={() => setSel(null)} puedeResetear={puedeResetear(sel)} puedeDarBaja={viewerRol === "admin"} />
      )}
    </>
  );
}

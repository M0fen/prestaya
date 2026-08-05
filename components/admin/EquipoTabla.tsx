"use client";
// Lista del equipo. Rediseño 08-05 (día 1 del piloto): antes mostraba "Conectado"
// = hubo login en 24 h, y con eso TODOS figuraban conectados y activos aunque
// nadie hubiera trabajado. Ahora la fila dice el ESTADO REAL del día —si abrió la
// app, si está cobrando, cuánto lleva, si tiene base y si rindió— y la lista se
// ordena por quien necesita atención primero, no alfabéticamente.
import { useState } from "react";
import { type MiembroEquipo, estadoDelDia, ETIQUETA_ESTADO_DIA } from "@/types/equipo";
import type { Rol } from "@/types/db";
import { UYU } from "@/lib/format";
import { DetalleVendedor } from "./DetalleVendedor";

function hace(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Cuánta atención pide esta persona HOY (mayor = más arriba). Un cobrador con
 *  cartera que no entró es lo primero que el supervisor tiene que ver; un
 *  cascarón sin ruta, lo último. */
function prioridad(m: MiembroEquipo): number {
  if (!m.activo) return -100;
  if (m.rol !== "cobrador") return -10;
  if (m.cartera === 0) return -50; // cuenta sin ruta: no es trabajo de hoy
  if (m.cobrosHoy > 0) return 10; // trabajando
  if (m.ultimaVistaIso) return 50; // abrió pero no cobró
  return 100; // con cartera y ni abrió la app
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
  const [verTodos, setVerTodos] = useState(false);

  const puedeResetear = (m: MiembroEquipo) =>
    viewerRol === "admin" || (viewerRol === "supervisor" && m.rol === "cobrador");

  // Los cobradores CON ruta son el trabajo del día; el resto (gestores, cuentas
  // sin cartera, bajas) se pliega para no ensuciar la lectura.
  const conRuta = miembros.filter((m) => m.activo && m.rol === "cobrador" && m.cartera > 0);
  const resto = miembros.filter((m) => !(m.activo && m.rol === "cobrador" && m.cartera > 0));
  const ordenar = (a: MiembroEquipo, b: MiembroEquipo) =>
    prioridad(b) - prioridad(a) || b.recaudadoHoy - a.recaudadoHoy || a.nombre.localeCompare(b.nombre);
  const principal = [...conRuta].sort(ordenar);
  const secundario = [...resto].sort(ordenar);

  const trabajando = conRuta.filter((m) => m.cobrosHoy > 0).length;
  const sinEntrar = conRuta.filter((m) => !m.ultimaVistaIso).length;
  const totalHoy = conRuta.reduce((s, m) => s + m.recaudadoHoy, 0);

  return (
    <>
      {/* Resumen del día: lo primero que necesita ver el que abre esta pantalla. */}
      {conRuta.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border border-borde bg-tarjeta px-4 py-3">
          <span className="text-[13px] font-bold text-tinta">
            <span className="text-[#157A50]">{trabajando}</span> de {conRuta.length} cobrando
          </span>
          <span className="text-[13px] font-bold text-tinta tabular-nums">{UYU(totalHoy)} hoy</span>
          {sinEntrar > 0 && (
            <span className="text-[13px] font-bold text-[#9A6A0E]">{sinEntrar} sin abrir la app</span>
          )}
        </div>
      )}

      <Tabla miembros={principal} onSel={setSel} />

      {secundario.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setVerTodos((v) => !v)}
            className="self-start rounded-full border border-borde bg-tarjeta px-3.5 py-1.5 text-[12.5px] font-bold text-gris hover:text-tinta"
          >
            {verTodos ? "Ocultar" : `Ver los otros ${secundario.length}`} · gestores, cuentas sin ruta y bajas
          </button>
          {verTodos && <Tabla miembros={secundario} onSel={setSel} />}
        </>
      )}

      {sel && (
        <DetalleVendedor
          m={sel}
          onClose={() => setSel(null)}
          puedeResetear={puedeResetear(sel)}
          puedeDarBaja={viewerRol === "admin"}
        />
      )}
    </>
  );
}

function Tabla({ miembros, onSel }: { miembros: MiembroEquipo[]; onSel: (m: MiembroEquipo) => void }) {
  if (miembros.length === 0)
    return (
      <p className="rounded-[16px] border border-borde bg-tarjeta px-4 py-8 text-center text-[13px] font-medium text-gris">
        Sin gente en esta lista.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
      <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
            <th className="px-3 py-2.5 text-left">Persona</th>
            <th className="px-3 py-2.5 text-left">Hoy</th>
            <th className="px-3 py-2.5 text-right">Cobros</th>
            <th className="px-3 py-2.5 text-right">Recaudado</th>
            <th className="px-3 py-2.5 text-right">Clientes</th>
            <th className="px-3 py-2.5 text-center">Base</th>
            <th className="px-3 py-2.5 text-center">Rindió</th>
            <th className="px-3 py-2.5 text-left">Última señal</th>
          </tr>
        </thead>
        <tbody>
          {miembros.map((m) => {
            const e = ETIQUETA_ESTADO_DIA[estadoDelDia(m)];
            return (
              <tr
                key={m.id}
                onClick={() => onSel(m)}
                className="cursor-pointer border-b border-[#F4F6FB] hover:bg-suave"
              >
                <td className="px-3 py-2.5">
                  <div className="flex flex-col">
                    <span className="font-bold text-tinta">{m.nombre}</span>
                    <span className="text-[10.5px] font-semibold text-tenue">
                      {m.esDev ? "Desarrollador" : m.rol}
                      {m.ruta ? ` · ${m.ruta.replace("Zona ", "")}` : ""}
                      {!m.claveCambiadaEn && m.activo ? " · 🔑 clave de arranque" : ""}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: e.bg, color: e.fg }}>
                    {e.txt}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-tinta tabular-nums">
                  {m.cobrosHoy || <span className="text-tenue-2">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-extrabold text-tinta tabular-nums">
                  {m.recaudadoHoy > 0 ? UYU(m.recaudadoHoy) : <span className="font-bold text-tenue-2">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-cuerpo tabular-nums">
                  {m.rol === "cobrador" ? m.cartera : <span className="text-tenue-2">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums">
                  {m.rol !== "cobrador" ? (
                    <span className="text-tenue-2">—</span>
                  ) : m.baseHoy == null ? (
                    <span className="text-[11px] font-bold text-tenue-2">sin cargar</span>
                  ) : (
                    <span className="text-[11.5px] font-semibold text-cuerpo">{UYU(m.baseHoy)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {m.rol !== "cobrador" ? (
                    <span className="text-tenue-2">—</span>
                  ) : m.rindio ? (
                    <span className="text-[11px] font-bold text-[#157A50]">✓</span>
                  ) : (
                    <span className="text-[11px] font-bold text-tenue-2">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[11.5px] text-tenue">
                  {m.ultimaVistaIso ? hace(m.ultimaVistaIso) : <span className="text-tenue-2">no abrió hoy</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

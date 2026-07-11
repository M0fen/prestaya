"use client";
// Modal de detalle de un vendedor (réplica de la ficha "Detalle" de Disapp).
// Overlay simple con estado local (sin librería de modal). Solo lectura; el
// botón "Editar" queda como acción pronto (no inventa backend nuevo).
import type { MiembroEquipo } from "@/types/equipo";
import type { Rol } from "@/types/db";

// Etiquetas de rol (locales: no importamos lib/auth, que es server-side).
const ETIQUETA_ROL: Record<Rol, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  cobrador: "Cobrador",
};

function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—"; // fecha ilegible → sin dato (no "Invalid Date")
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function DetalleVendedor({ m, onClose }: { m: MiembroEquipo; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-[440px] overflow-y-auto rounded-[20px] bg-tarjeta p-5 shadow-[0_20px_60px_rgba(19,48,140,0.35)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Cabecera */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] bg-[#2453DC] text-[18px] font-black text-white">
            {(m.nombre || "?").charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[16px] font-extrabold text-tinta">{m.nombre}</span>
            <span className="truncate text-[12px] font-medium text-tenue">{m.email ?? "Sin email"}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-suave text-[15px] font-black text-gris active:scale-90"
          >
            ✕
          </button>
        </div>

        {/* Estado / rol / conectado */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip
            texto={m.activo ? "Activo" : "Inactivo"}
            bg={m.activo ? "#E4F5EC" : "#F1F3F9"}
            fg={m.activo ? "#157A50" : "#8A93AD"}
          />
          <Chip texto={m.esDev ? "Desarrollador" : ETIQUETA_ROL[m.rol]} bg="#EAF0FF" fg="#1E47C8" />
          <Chip
            texto={m.conectado ? "Conectado (24 h)" : "Desconectado"}
            bg={m.conectado ? "#E4F5EC" : "#FBECEC"}
            fg={m.conectado ? "#157A50" : "#B23B3B"}
          />
        </div>

        {/* Detalle */}
        <dl className="mt-4 flex flex-col divide-y divide-linea">
          <Fila k="ID (Ref Disapp)" v={m.refDisapp ?? "—"} />
          <Fila k="Documento" v={m.documento ?? "—"} />
          <Fila k="Teléfono" v={m.telefono ?? "—"} />
          <Fila k="Rol" v={m.esDev ? "Desarrollador" : ETIQUETA_ROL[m.rol]} />
          <Fila k="Ruta asignada" v={m.ruta ?? "—"} />
          <Fila k="Dispositivos" v={`${m.dispositivos}`} />
          <Fila k="Fecha de registro" v={fechaHora(m.creadoEnIso)} />
          <Fila k="Último acceso" v={fechaHora(m.ultimoAccesoIso)} />
        </dl>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled
            title="Edición de vendedor: pronto"
            className="cursor-not-allowed rounded-full border border-borde bg-tarjeta px-4 py-2 text-[13px] font-bold text-[#AEB6CC]"
          >
            Editar vendedor (pronto)
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ texto, bg, fg }: { texto: string; bg: string; fg: string }) {
  return (
    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: bg, color: fg }}>
      {texto}
    </span>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-[12px] font-medium text-gris">{k}</dt>
      <dd className="text-right text-[13px] font-semibold text-tinta">{v}</dd>
    </div>
  );
}

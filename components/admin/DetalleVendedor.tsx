"use client";
// Modal de detalle de un vendedor (réplica de la ficha "Detalle" de Disapp).
// Overlay simple con estado local (sin librería de modal). Solo lectura; el
// botón "Editar" queda como acción pronto (no inventa backend nuevo).
import Link from "next/link";
import type { MiembroEquipo } from "@/types/equipo";
import type { Rol } from "@/types/db";
import { RestablecerAcceso } from "./RestablecerAcceso";
import { BajaUsuario } from "./BajaUsuario";

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

export function DetalleVendedor({
  m,
  onClose,
  puedeResetear = false,
  puedeDarBaja = false,
}: {
  m: MiembroEquipo;
  onClose: () => void;
  /** ¿El que mira puede restablecer el acceso de este miembro? (admin, o
   *  supervisor para cobradores de su zona). La autorización real es server-side. */
  puedeResetear?: boolean;
  /** ¿Puede dar de baja / reactivar? Solo admin (offboarding). Server-side manda. */
  puedeDarBaja?: boolean;
}) {
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
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] avatar-marca text-[18px] font-black text-white">
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

        {/* Perfil operativo: el status REAL de la persona (su recorrido de hoy,
            cómo viene la plata, su paso por el campo). Lo que este modal no puede
            mostrar sin volverse una pantalla entera. */}
        <Link
          href={`/admin/cobrador/${m.id}`}
          className="mt-4 flex items-center justify-between gap-2 rounded-[14px] bg-azul-suave px-4 py-3 text-[13.5px] font-extrabold text-azul active:scale-[0.99]"
        >
          <span>📋 Ver perfil completo · cómo va hoy</span>
          <span aria-hidden="true">→</span>
        </Link>

        {/* Detalle */}
        <dl className="mt-3 flex flex-col divide-y divide-linea">
          <Fila k="ID (sistema anterior)" v={m.refDisapp ?? "—"} />
          <Fila k="Documento" v={m.documento ?? "—"} />
          <Fila k="Teléfono" v={m.telefono ?? "—"} />
          <Fila k="Rol" v={m.esDev ? "Desarrollador" : ETIQUETA_ROL[m.rol]} />
          <Fila k="Ruta asignada" v={m.ruta ?? "—"} />
          <Fila k="Dispositivos" v={`${m.dispositivos}`} />
          <Fila k="Fecha de registro" v={fechaHora(m.creadoEnIso)} />
          <Fila k="Último acceso" v={fechaHora(m.ultimoAccesoIso)} />
        </dl>

        {/* Restablecer acceso: si el que mira puede (admin, o supervisor para
            un cobrador de su zona). Cubre el hueco de "olvidé mi contraseña". */}
        {(puedeResetear || puedeDarBaja) && (
          <div className="mt-4 flex flex-col gap-3 border-t border-linea pt-4">
            <span className="block text-[11px] font-bold tracking-wide text-gris uppercase">
              Acceso
            </span>
            {puedeResetear && (
              <RestablecerAcceso usuarioId={m.id} nombre={m.nombre} telefono={m.telefono} />
            )}
            {puedeDarBaja && <BajaUsuario usuarioId={m.id} nombre={m.nombre} activo={m.activo} />}
          </div>
        )}
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

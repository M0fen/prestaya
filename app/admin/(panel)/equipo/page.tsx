// Equipo y permisos (solo ADMIN). Lista el equipo y documenta qué puede hacer
// cada rol. Los permisos sensibles (mora, comisiones, anular pagos) se aplican
// además en el servidor (requireAdmin / esAdmin en cada acción).
import { requireAdmin, etiquetaRol } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Rol } from "@/types/db";

export const dynamic = "force-dynamic";

const ROL_BADGE: Record<Rol, { bg: string; fg: string }> = {
  admin: { bg: "#EAF0FF", fg: "#1E47C8" },
  supervisor: { bg: "#E7F1FF", fg: "#1C6BD6" },
  cobrador: { bg: "#E4F5EC", fg: "#157A50" },
};

// Matriz de permisos (documenta el modelo; el enforcement real está en el server).
type Cel = "si" | "no" | "campo";
const PERMISOS: { accion: string; admin: Cel; supervisor: Cel; cobrador: Cel }[] = [
  { accion: "Ver dashboard, clientes, mora y caja", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Descargar reportes y respaldo", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Configurar juego, anuncios y promos", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Editar la política de mora", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Fijar y liquidar comisiones", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Anular pagos (cuando se habilite)", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Registrar cobros y visitas en ruta", admin: "no", supervisor: "no", cobrador: "campo" },
];

export default async function EquipoPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const { data } = await db
    .from("usuarios")
    .select("id, nombre, rol, activo")
    .order("rol")
    .order("nombre");
  const usuarios = (data ?? []) as { id: string; nombre: string; rol: Rol; activo: boolean }[];

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Equipo y permisos</h1>
        <span className="text-[13px] font-medium text-gris">
          Quién es quién y qué puede hacer cada uno. Las acciones sensibles quedan solo para vos (admin).
        </span>
      </div>

      {/* Integrantes */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Integrantes</span>
        <ul className="flex flex-col divide-y divide-[#EEF1F8] overflow-hidden rounded-[16px] border border-[#E6EAF4] bg-white">
          {usuarios.map((u) => {
            const badge = ROL_BADGE[u.rol] ?? ROL_BADGE.cobrador;
            return (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-[#2453DC] text-[14px] font-black text-white">
                  {u.nombre.charAt(0).toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-tinta">{u.nombre}</span>
                {!u.activo && (
                  <span className="rounded-full bg-[#F1F3F9] px-2.5 py-1 text-[11px] font-bold text-[#8A93AD]">
                    Inactivo
                  </span>
                )}
                <span
                  className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: badge.bg, color: badge.fg }}
                >
                  {etiquetaRol[u.rol]}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Matriz de permisos */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Qué puede cada rol</span>
        <div className="overflow-x-auto rounded-[16px] border border-[#E6EAF4] bg-white">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[#EEF1F8] text-[11px] font-bold tracking-wide text-gris uppercase">
                <th className="px-4 py-2.5 text-left">Acción</th>
                <th className="px-2 py-2.5 text-center">Admin</th>
                <th className="px-2 py-2.5 text-center">Supervisor</th>
                <th className="px-2 py-2.5 text-center">Cobrador</th>
              </tr>
            </thead>
            <tbody>
              {PERMISOS.map((p) => (
                <tr key={p.accion} className="border-b border-[#F4F6FB]">
                  <td className="px-4 py-2.5 font-medium text-tinta">{p.accion}</td>
                  <td className="px-2 py-2.5 text-center"><Marca v={p.admin} /></td>
                  <td className="px-2 py-2.5 text-center"><Marca v={p.supervisor} /></td>
                  <td className="px-2 py-2.5 text-center"><Marca v={p.cobrador} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-[1.6] font-medium text-[#8A93AD]">
          El supervisor (tu esposa) ve toda la operación pero no puede tocar mora, comisiones ni
          anular pagos: eso queda protegido en el servidor, no solo escondido en la pantalla. Para
          cambiar roles o dar de alta a alguien, avisame y lo hacemos.
        </p>
      </section>
    </div>
  );
}

function Marca({ v }: { v: "si" | "no" | "campo" }) {
  if (v === "si") return <span className="text-[15px] font-black text-[#1FA971]">✓</span>;
  if (v === "campo")
    return <span className="text-[11px] font-bold text-[#8A6D1E]">en su app</span>;
  return <span className="text-[15px] font-black text-[#D0D5E2]">–</span>;
}

// Equipo y permisos (solo ADMIN). Lista el equipo y documenta qué puede hacer
// cada rol. Los permisos sensibles (mora, comisiones, anular pagos) se aplican
// además en el servidor (requireAdmin / esAdmin en cada acción).
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getZonas } from "@/lib/data/zonas";
import { getEquipoDetallado } from "@/lib/data/equipo";
import { NuevoUsuario } from "@/components/admin/NuevoUsuario";
import { EquipoTabla } from "@/components/admin/EquipoTabla";

export const dynamic = "force-dynamic";

// Matriz de permisos (documenta el modelo; el enforcement real está en el server).
type Cel = "si" | "no" | "campo";
const PERMISOS: { accion: string; admin: Cel; supervisor: Cel; cobrador: Cel }[] = [
  { accion: "Ver dashboard, clientes, mora y caja", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Descargar reportes y respaldo", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Publicar anuncios y banners al cliente", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Configurar juegos, rifas y sorteos del cliente", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Avisar al equipo (banner al equipo)", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Editar la política de mora", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Fijar y liquidar comisiones", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Gestionar zonas (crear, mover cobradores)", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Anular un pago directo", admin: "si", supervisor: "no", cobrador: "no" },
  { accion: "Solicitar / confirmar anulación (doble registro)", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Reasignar cliente entre cobradores (misma zona)", admin: "si", supervisor: "si", cobrador: "no" },
  { accion: "Registrar cobros y visitas en ruta", admin: "no", supervisor: "no", cobrador: "campo" },
];

export default async function EquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const usuario = await requireGestor();
  const admin = esAdmin(usuario.rol);
  const db = await createSupabaseServer();
  // La lista viene ya acotada por RLS: el supervisor ve gestores + los cobradores
  // de SU zona (0060). Las zonas solo hacen falta para el alta (admin).
  const [miembros, zonas] = await Promise.all([
    getEquipoDetallado(db),
    admin ? getZonas(db) : Promise.resolve([]),
  ]);

  // Buscador (GET) por nombre / email / documento.
  const termino = (q ?? "").trim().toLowerCase();
  const filtrados = termino
    ? miembros.filter(
        (m) =>
          m.nombre.toLowerCase().includes(termino) ||
          (m.email ?? "").toLowerCase().includes(termino) ||
          (m.documento ?? "").toLowerCase().includes(termino),
      )
    : miembros;

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Equipo y permisos</h1>
        <span className="text-[13px] font-medium text-gris">
          {admin
            ? "Quién es quién y qué puede hacer cada uno. Las acciones sensibles quedan solo para vos (admin)."
            : "Tu equipo. Si un cobrador olvidó su contraseña, tocá su fila y restablecé su acceso."}
        </span>
      </div>

      {/* Alta de usuarios (= "Crear Vendedor"): solo admin. */}
      {admin && <NuevoUsuario zonas={zonas} />}

      {/* Vendedores (lista estilo Disapp) */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Vendedores ({filtrados.length})
          </span>
          <form method="get" className="flex gap-1.5">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nombre, email o documento…"
              className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13px] outline-none focus:border-azul"
            />
            <button type="submit" className="rounded-[10px] bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white">
              Buscar
            </button>
          </form>
        </div>
        <EquipoTabla miembros={filtrados} viewerRol={usuario.rol} />
        <p className="text-[10.5px] font-medium text-tenue-2">
          "Conectado" es un proxy honesto: indica login en las últimas 24 h (no presencia en vivo).
          "Dispositivos" = suscripciones push activas del usuario.
        </p>
      </section>

      {/* Matriz de permisos */}
      <section className="flex flex-col gap-2">
        <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">Qué puede cada rol</span>
        <div className="overflow-x-auto rounded-[16px] border border-borde bg-tarjeta">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-linea text-[11px] font-bold tracking-wide text-gris uppercase">
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
        <p className="text-[11px] leading-[1.6] font-medium text-tenue">
          El supervisor ve su(s) zona(s) y no puede tocar mora, comisiones ni anular pagos directo:
          eso queda protegido en el servidor (RLS), no solo escondido en la pantalla. Sí puede
          <b> solicitar</b> una anulación, que confirma una segunda persona (doble registro). Un
          supervisor sin zonas asignadas ve todo hasta que le pongas la primera. Para cambiar roles o
          dar de alta a alguien, avisame y lo hacemos.
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

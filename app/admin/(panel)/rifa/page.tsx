// Rifa promocional (solo admin): un banner con mensaje + foto del premio que se
// les muestra a los clientes (o solo a los mejores). Marketing, sin dinero.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRifa, getParticipacionesRifa } from "@/lib/data/rifas";
import { getZonas } from "@/lib/data/zonas";
import { RifaAdmin } from "@/components/admin/RifaAdmin";
import { RifaSorteo } from "@/components/admin/RifaSorteo";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function RifaPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [rifa, zonas] = await Promise.all([getRifa(db), getZonas(db)]);
  // Sorteo real (0098): participantes + nombre del ganador (siempre está entre ellos).
  const participantes = rifa ? await getParticipacionesRifa(db, rifa.id) : [];
  const ganadorNombre = rifa?.ganadorClienteId
    ? participantes.find((p) => p.clienteId === rifa.ganadorClienteId)?.clienteNombre ?? null
    : null;

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Rifa</h1>
          <span className="text-[13px] font-medium text-gris">
            Armá una rifa para tus clientes: un banner con tu mensaje y la foto del premio. Podés
            dirigirla a un rango de personas (por calificación, estado o zona). El cliente la ve en su pantalla.
          </span>
        </div>
        <EtiquetaAudiencia audiencia="cliente" />
      </div>

      <RifaAdmin rifa={rifa} zonas={zonas.map((z) => ({ id: z.id, nombre: z.nombre }))} />

      {/* Sorteo real (0098): participantes + sortear/elegir ganador + cerrar. */}
      {rifa && (
        <RifaSorteo
          rifaId={rifa.id}
          estado={rifa.estado}
          participantes={participantes}
          ganadorNombre={ganadorNombre}
          ganadorNumero={rifa.ganadorNumero}
          folio={rifa.folio}
        />
      )}

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Promocional: la rifa es un incentivo por estar al día. El sorteo elige un ganador entre los
        participantes reales y queda registrado con su comprobante. Requiere las migraciones 0045 y 0098.
      </p>
    </div>
  );
}

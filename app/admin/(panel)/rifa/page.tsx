// Rifa promocional (solo admin): un banner con mensaje + foto del premio que se
// les muestra a los clientes (o solo a los mejores). Marketing, sin dinero.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getRifa } from "@/lib/data/rifas";
import { getZonas } from "@/lib/data/zonas";
import { RifaAdmin } from "@/components/admin/RifaAdmin";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function RifaPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const [rifa, zonas] = await Promise.all([getRifa(db), getZonas(db)]);

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

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        Promocional: la rifa es un incentivo por estar al día. Requiere la migración 0045.
      </p>
    </div>
  );
}

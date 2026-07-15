// Banner al equipo (admin/supervisor): un aviso fijo arriba de la ruta de TODOS
// los cobradores. Antes vivía escondido DENTRO de Chat; ahora tiene su propia
// sección ("Para tu equipo") para que el admin descubra cómo avisarle al equipo.
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getBannersCobrador } from "@/lib/data/bannerCobrador";
import { BannerCobradorManager } from "@/components/admin/BannerCobradorManager";
import { EtiquetaAudiencia } from "@/components/admin/EtiquetaAudiencia";

export const dynamic = "force-dynamic";

export default async function BannerEquipoPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const banners = await getBannersCobrador(db);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Banner al equipo</h1>
          <span className="text-[13px] font-medium text-gris">
            Un aviso fijo arriba de la ruta de tu equipo de cobradores — lo ven apenas abren su app.
            Usalo para arrancar la jornada, recordar la hora del cierre o felicitarlos por el día. 📢
          </span>
        </div>
        <EtiquetaAudiencia audiencia="equipo" />
      </div>

      <BannerCobradorManager banners={banners} />
    </div>
  );
}

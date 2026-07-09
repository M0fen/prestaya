// Modelo de scoring (SOLO admin): ajustar pesos de los factores y umbrales de
// banda. El score se calcula (no se guarda), así que cambiarlo re-puntúa a todos.
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getConfigScoring } from "@/lib/data/scoringConfig";
import { FormScoring } from "@/components/admin/FormScoring";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  await requireAdmin();
  const db = await createSupabaseServer();
  const config = await getConfigScoring(db);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Modelo de scoring</h1>
        <span className="text-[13px] font-medium text-gris">
          Ajustá cómo se calcula el puntaje crediticio de tus clientes. Se aplica a todos al instante.
        </span>
      </div>

      <FormScoring inicial={config} />

      <p className="text-[11.5px] leading-[1.6] font-medium text-tenue">
        El scorecard es transparente: el puntaje (0–1000) es la suma ponderada de los factores, con
        penalización por castigos graves (créditos cancelados o incobrables). Es interno: no se le
        muestra al cliente. Cambiar los pesos ayuda a afinar a quién y cuánto prestar según tu experiencia.
      </p>
    </div>
  );
}

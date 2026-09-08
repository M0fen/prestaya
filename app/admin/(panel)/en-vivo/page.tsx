// EN VIVO (solo dev): quién está en la app ahora, en qué pantalla, y qué hizo
// hoy — hechos con plata y navegación en una sola línea de tiempo que se
// actualiza sola. Lo de ayer y la adopción viven en /admin/uso.
import { requireDev } from "@/lib/auth";
import { getEnVivo } from "@/lib/data/enVivo";
import { EnVivoTablero } from "@/components/admin/EnVivoTablero";

export const dynamic = "force-dynamic";

export default async function EnVivoPage() {
  await requireDev();
  const inicial = await getEnVivo();
  return <EnVivoTablero inicial={inicial} />;
}

// Skeleton universal del panel: se muestra mientras cualquier pantalla trae sus
// datos (Suspense). Da feedback inmediato en la navegación (velocidad percibida);
// en pantallas rápidas apenas aparece, en las pesadas (dashboard/caja) se nota.
import { HeaderSkel, GridSkel, BloqueSkel, LineaCalida } from "@/components/admin/Esqueleto";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <LineaCalida texto="Un momento, cargando…" />
      <HeaderSkel />
      <GridSkel n={4} alto="h-16" cols="grid-cols-2 md:grid-cols-4" />
      <BloqueSkel className="h-40 w-full" />
      <BloqueSkel className="h-40 w-full" />
    </div>
  );
}

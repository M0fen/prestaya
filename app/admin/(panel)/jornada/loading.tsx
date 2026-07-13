// Skeleton específico de "Mi jornada": dibuja su forma real (pulso héroe + stepper
// + contenido) para que abrir el hub se sienta instantáneo.
import { GridSkel, BloqueSkel, LineaCalida } from "@/components/admin/Esqueleto";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <LineaCalida texto="Preparando tu jornada…" />
      {/* Encabezado */}
      <div className="flex flex-col gap-2">
        <BloqueSkel className="h-7 w-52" />
        <BloqueSkel className="h-4 w-64 max-w-full" />
      </div>
      {/* DateBar */}
      <BloqueSkel className="h-11 w-60 max-w-full" />
      {/* Pulso héroe + secundarios */}
      <BloqueSkel className="h-[92px] w-full" />
      <GridSkel n={3} alto="h-16" />
      {/* Launchpad colapsado */}
      <BloqueSkel className="h-11 w-full" />
      {/* Stepper */}
      <div className="grid grid-cols-3 gap-2">
        <BloqueSkel className="h-[74px]" />
        <BloqueSkel className="h-[74px]" />
        <BloqueSkel className="h-[74px]" />
      </div>
      {/* Contenido del acto */}
      <BloqueSkel className="h-44 w-full" />
    </div>
  );
}

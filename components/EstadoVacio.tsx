// ─────────────────────────────────────────────────────────────────────────
//  Estado VACÍO ilustrado (pasada estética 08-14). Antes cada lista vacía era
//  un párrafo gris suelto; esto le da un ancla visual de marca (ícono del set
//  propio en un disco suave) + título + explicación, y admite un CTA como hijo.
//  Server-safe (sin hooks): se usa igual en páginas y en componentes cliente.
// ─────────────────────────────────────────────────────────────────────────
import { Icono, type NombreIcono } from "@/components/Iconos";

export function EstadoVacio({
  icono,
  titulo,
  texto,
  children,
}: {
  icono: NombreIcono;
  titulo: string;
  texto?: string;
  /** CTA opcional (botón/link) debajo del texto. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[16px] bg-tarjeta px-5 py-7 text-center shadow-sm">
      <span className="mb-0.5 flex h-14 w-14 items-center justify-center rounded-full bg-azul-suave text-azul">
        <Icono name={icono} className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <span className="text-[14px] font-extrabold text-tinta">{titulo}</span>
      {texto && (
        <p className="max-w-[320px] text-[12.5px] leading-[1.55] font-medium text-gris">{texto}</p>
      )}
      {children}
    </div>
  );
}

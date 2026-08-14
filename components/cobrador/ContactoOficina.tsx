// Contacto directo a la oficina desde la app del cobrador (además del chat).
// Para el que se traba en la calle y quiere resolver YA: WhatsApp o llamada.
// Server component: el enlace se resuelve del entorno (lib/soporte.ts).
import { enlaceSoporte, SOPORTE_TEL, SOPORTE_WHATSAPP } from "@/lib/soporte";

export function ContactoOficina() {
  const soporte = enlaceSoporte("Hola, soy cobrador de Presta Ya y necesito ayuda con:");
  // Sin canal configurado, la tarjeta no aparece (jamás un número inventado).
  if (!soporte) return null;

  return (
    <a
      href={soporte.href}
      target={soporte.esWhatsApp ? "_blank" : undefined}
      rel={soporte.esWhatsApp ? "noopener noreferrer" : undefined}
      className="flex items-center gap-3 rounded-[14px] border border-campo bg-tarjeta px-4 py-3 shadow-sm active:scale-[0.99]"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-verde-suave text-[18px]"
      >
        {soporte.esWhatsApp ? "💬" : "📞"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-extrabold text-tinta">
          {soporte.esWhatsApp ? "Escribir a la oficina" : "Llamar a la oficina"}
        </span>
        <span className="text-[11.5px] font-medium text-gris">
          {soporte.esWhatsApp
            ? "Ayuda directa por WhatsApp si algo no anda"
            : `Ayuda directa · ${SOPORTE_TEL}`}
        </span>
      </div>
      <span aria-hidden="true" className="flex-shrink-0 text-[18px] text-azul">
        ›
      </span>
    </a>
  );
}

/** ¿Hay algún canal de soporte configurado? (si no, la sección no se muestra). */
export const HAY_SOPORTE = Boolean(SOPORTE_WHATSAPP || SOPORTE_TEL);

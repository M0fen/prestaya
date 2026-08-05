// Pie: sello de seguridad, datos del negocio, CONTACTO y nota legal.
import type { Negocio } from "@/types/cartones";
import { enlaceSoporte } from "@/lib/soporte";

export function Footer({ negocio }: { negocio: Negocio }) {
  // Canal real de contacto (QA 08-05): el pie decía "comunicate con tu oficina"
  // sin ningún teléfono ni link en toda la vista. Si hay canal configurado,
  // acá está; si no, no se inventa nada.
  const soporte = enlaceSoporte("Hola, soy cliente de Presta Ya y tengo una consulta sobre mi crédito.");
  return (
    <footer className="mt-1.5 flex flex-col gap-3.5">
      <div className="flex items-center justify-center gap-2 rounded-[13px] border border-[#DCE6FB] bg-[#EEF3FF] px-3.5 py-[11px]">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className="flex-shrink-0"
        >
          <circle cx="12" cy="12" r="10" fill="#1E47C8" />
          <path
            d="M8 12.5l2.5 2.5L16 9.5"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[12.5px] font-semibold text-azul">
          Conexión segura y privada · tus datos protegidos
        </span>
      </div>

      <div className="flex flex-col gap-[5px] px-2 py-1 text-center">
        <span className="text-[14px] font-extrabold tracking-[-0.01em] text-tinta">
          {negocio.nombre}
        </span>
        <span className="text-[12px] font-medium text-[#8A93AD]">
          {negocio.horario}
        </span>
      </div>

      {soporte && (
        <a
          href={soporte.href}
          target={soporte.esWhatsApp ? "_blank" : undefined}
          rel={soporte.esWhatsApp ? "noopener noreferrer" : undefined}
          className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#DCE6FB] bg-white px-4 py-2.5 text-[13px] font-bold text-azul active:scale-95"
        >
          <span aria-hidden="true">{soporte.esWhatsApp ? "💬" : "📞"}</span>
          {soporte.esWhatsApp ? "Escribir a la oficina" : `Llamar a la oficina · ${negocio.telefono}`}
        </a>
      )}

      <span className="px-4 text-center text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        Esta es una pantalla informativa de tu estado de cuenta. Para cualquier
        gestión, comunicate directamente con tu oficina.
      </span>
    </footer>
  );
}

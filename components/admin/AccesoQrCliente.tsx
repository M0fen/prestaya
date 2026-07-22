// Acceso del cliente visto desde la oficina: el MISMO QR que muestra el
// cobrador en la calle, más el estado del alta (¿ya abrió su cartón?).
// Server component: el QR se arma en el servidor (ver lib/qr.ts).
import { QrCodigo } from "@/components/QrCodigo";
import { estadoAlta } from "@/lib/data/acceso";
import { fechaHoraUY } from "@/lib/format";

export function AccesoQrCliente({
  nombre,
  url,
  acceso,
}: {
  nombre: string;
  url: string;
  acceso: { acceso_entregado_en: string | null; acceso_visto_en: string | null };
}) {
  const estado = estadoAlta(acceso);
  const tono =
    estado === "activo"
      ? { bg: "#E4F5EC", fg: "#157A50", txt: `Usa la app · abrió el ${fechaHoraUY(acceso.acceso_visto_en)}` }
      : estado === "entregado"
        ? { bg: "#EAF0FF", fg: "#1E47C8", txt: `Entregado el ${fechaHoraUY(acceso.acceso_entregado_en)} · sin abrir` }
        : { bg: "#F3F5FB", fg: "#6B7494", txt: "Todavía no se le entregó el link" };

  return (
    <section className="rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-tinta">Código QR del cliente</span>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: tono.bg, color: tono.fg }}
        >
          {tono.txt}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-[12px] border border-[#E9EDF7] bg-white p-2">
          <QrCodigo texto={url} tam={168} etiqueta={`Código QR del cartón de ${nombre}`} />
        </div>
        <p className="min-w-[200px] flex-1 text-[11.5px] leading-relaxed font-medium text-tenue">
          El cliente lo escanea con la cámara y entra a su cartón sin usuario ni contraseña.
          Es el mismo código que ve el cobrador en la ficha del cliente.
          <br />
          Se puede imprimir desde esta página.
        </p>
      </div>
    </section>
  );
}

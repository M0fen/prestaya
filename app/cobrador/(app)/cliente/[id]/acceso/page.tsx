// ─────────────────────────────────────────────────────────────────────────
//  DAR DE ALTA al cliente en la app — pantalla del cobrador.
//
//  El cliente entra a su cartón sin usuario ni contraseña: con un link
//  personal (token). Acá el cobrador se lo entrega de dos formas:
//    · QR   → el cliente lo escanea con su cámara. No hay nada que escribir,
//             así que no hay forma de equivocarse de link.
//    · WhatsApp → le queda guardado en el chat.
//
//  Precisión ante todo: arriba del QR va SIEMPRE la identidad del cliente
//  (nombre + registro), porque entregar el link equivocado le mostraría a una
//  persona el cartón de otra.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getClientePorId } from "@/lib/data/clientes";
import { estadoAlta } from "@/lib/data/acceso";
import { urlCartonCliente } from "@/lib/urlApp";
import { fechaHoraUY } from "@/lib/format";
import { QrCodigo } from "@/components/QrCodigo";
import { AccionesAcceso } from "@/components/cobrador/AccionesAcceso";
import { NoUsaApp } from "@/components/cobrador/NoUsaApp";

export const dynamic = "force-dynamic";

export default async function AccesoClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await createSupabaseServer();
  // RLS: el cobrador solo ve los clientes de su ruta. Si no es suyo → 404.
  const cliente = await getClientePorId(db, id);
  if (!cliente) notFound();

  const url = await urlCartonCliente(cliente.token_acceso);
  const estado = estadoAlta(cliente);
  const inicial = (cliente.nombre ?? "").trim().charAt(0).toUpperCase() || "—";

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/cobrador/cliente/${id}`} className="text-[13px] font-semibold text-gris">
        ← Ficha del cliente
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-[21px] font-extrabold text-tinta">Dar de alta en la app</h1>
        <p className="text-[13px] font-medium text-gris">
          Que el cliente escanee el código y su cartón le queda en el teléfono.
        </p>
      </div>

      {/* IDENTIDAD — confirmá que es la persona antes de entregar el link. */}
      <div className="flex items-center gap-3 rounded-[16px] border border-[#E4E8F4] bg-white p-3.5">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[#2453DC] text-[17px] font-black text-white">
          {inicial}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="text-[11.5px] font-semibold text-gris tabular-nums">
            {cliente.numero_registro != null ? `Registro N.º ${cliente.numero_registro}` : "Sin nº de registro"}
            {cliente.telefono ? ` · ${cliente.telefono}` : " · sin teléfono"}
          </span>
        </div>
      </div>

      {/* EL QR — la pieza central. Fondo blanco puro y máximo contraste. */}
      <div className="flex flex-col items-center gap-3 rounded-[20px] bg-white px-4 py-6 shadow-[0_10px_28px_rgba(19,48,140,0.10)]">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-[linear-gradient(135deg,#2453DC,#13308C)] text-[11px] font-black text-white">
            P
          </div>
          <span className="text-[12.5px] font-extrabold tracking-wide text-tinta uppercase">
            Presta Ya · Mi cartón
          </span>
        </div>

        <QrCodigo texto={url} tam={244} etiqueta={`Código QR del cartón de ${cliente.nombre}`} />

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">{cliente.nombre}</span>
          <span className="text-[11.5px] font-semibold text-gris">
            Apuntá la cámara del cliente a este código
          </span>
        </div>
      </div>

      {/* Los 3 pasos, para que el cobrador se los diga tal cual. */}
      <ol className="flex flex-col gap-2 rounded-[16px] bg-[#EEF3FF] p-4">
        {[
          "Abrí la cámara del teléfono del cliente.",
          "Apuntá al código de arriba (sin sacar la foto).",
          "Tocá el aviso que aparece: ahí está su cartón.",
        ].map((paso, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-[1px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#1E47C8] text-[11px] font-black text-white tabular-nums">
              {i + 1}
            </span>
            <span className="text-[13px] font-semibold text-[#26365F]">{paso}</span>
          </li>
        ))}
      </ol>

      <AccionesAcceso
        clienteId={id}
        nombre={cliente.nombre}
        telefono={cliente.telefono}
        url={url}
        entregado={estado === "entregado" || estado === "activo"}
      />

      {/* ESTADO DEL ALTA — "visto" es la prueba real: lo abrió el cliente. */}
      <EstadoAltaCard
        estado={estado}
        entregadoEn={cliente.acceso_entregado_en}
        vistoEn={cliente.acceso_visto_en}
      />

      {/* La salida para quien no tiene celular (0131). */}
      <NoUsaApp
        clienteId={id}
        marcado={estado === "no_aplica"}
        motivo={cliente.app_no_aplica_motivo ?? null}
      />

      <p className="rounded-[13px] border border-[#F0E3C8] bg-[#FDF8EC] px-3.5 py-3 text-[11.5px] font-medium text-[#7A5B10]">
        🔒 Este link es <b>personal de {cliente.nombre}</b>: quien lo tenga ve su cartón. No se
        lo pases a otra persona. Si se filtra, la oficina puede regenerarlo.
      </p>
    </div>
  );
}

function EstadoAltaCard({
  estado,
  entregadoEn,
  vistoEn,
}: {
  estado: ReturnType<typeof estadoAlta>;
  entregadoEn: string | null;
  vistoEn: string | null;
}) {
  const tono =
    estado === "activo"
      ? { bg: "#E4F5EC", fg: "#157A50", icono: "🎉", titulo: "Ya está usando la app" }
      : estado === "entregado"
        ? { bg: "#EAF0FF", fg: "#1E47C8", icono: "📨", titulo: "Link entregado" }
        : estado === "no_aplica"
          ? { bg: "#F3F5FB", fg: "#6B7494", icono: "○", titulo: "No usa la app" }
          : { bg: "#F3F5FB", fg: "#6B7494", icono: "○", titulo: "Todavía sin entregar" };

  const detalle =
    estado === "activo"
      ? `Abrió su cartón por primera vez el ${fechaHoraUY(vistoEn)}`
      : estado === "entregado"
        ? `Se lo entregaste el ${fechaHoraUY(entregadoEn)} · falta que lo abra`
        : estado === "no_aplica"
          ? "Fuera de la campaña de altas · le seguís cobrando normal"
          : "Mostrale el código o mandale el WhatsApp";

  return (
    <div className="flex items-center gap-3 rounded-[14px] px-4 py-3" style={{ background: tono.bg }}>
      <span aria-hidden="true" className="text-[16px]">
        {tono.icono}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] font-extrabold" style={{ color: tono.fg }}>
          {tono.titulo}
        </span>
        <span className="text-[11.5px] font-medium" style={{ color: tono.fg }}>
          {detalle}
        </span>
      </div>
    </div>
  );
}

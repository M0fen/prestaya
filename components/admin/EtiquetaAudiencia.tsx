// Etiqueta de AUDIENCIA para las páginas del panel: deja claro de un vistazo si lo
// que se configura ahí lo ve el CLIENTE (deudor, en su pantalla) o el EQUIPO
// (cobradores/supervisores, en su app). Resuelve la confusión de "¿esto es para el
// cliente o para el equipo?" sin tener que leer el copy. Presentacional (sin estado).
export function EtiquetaAudiencia({
  audiencia,
  nota,
}: {
  audiencia: "cliente" | "equipo";
  /** Aclaración corta, p. ej. "en pausa para clientes en esta etapa". */
  nota?: string;
}) {
  const cliente = audiencia === "cliente";
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold ${
        cliente ? "bg-[#EAF0FF] text-[#1E47C8]" : "bg-[#E6F7F0] text-[#157A50]"
      }`}
    >
      <span aria-hidden>{cliente ? "👥" : "🧑‍🔧"}</span>
      {cliente ? "Lo ven tus CLIENTES" : "Lo ve tu EQUIPO"}
      {nota && <span className="font-semibold opacity-75">· {nota}</span>}
    </span>
  );
}

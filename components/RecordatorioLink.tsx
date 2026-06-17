// Enlace para agregar un recordatorio diario de la cuota al calendario (.ics).
// Sin login ni permisos de notificación: descarga un archivo de calendario.
export function RecordatorioLink({ token }: { token: string }) {
  return (
    <a
      href={`/c/${encodeURIComponent(token)}/recordatorio`}
      className="flex items-center justify-center gap-2 rounded-[13px] border border-[#DCE6FB] bg-[#EEF3FF] px-4 py-3 text-[13px] font-bold text-azul"
    >
      <span aria-hidden="true">📅</span>
      Agregar recordatorio diario a mi calendario
    </a>
  );
}

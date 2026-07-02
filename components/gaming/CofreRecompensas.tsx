// Cofre de recompensas de la vista de cliente. Muestra los premios que el admin
// definió y cuáles ya desbloqueó por su comportamiento de pago (tono amable,
// sin presión: es "lo que ganaste", no "lo que debés").
import type { RecompensaEvaluada } from "@/lib/recompensas";

export function CofreRecompensas({ recompensas }: { recompensas: RecompensaEvaluada[] }) {
  if (recompensas.length === 0) return null;
  const listas = recompensas.filter((r) => r.estado === "desbloqueada").length;

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#F0E4C0] bg-[linear-gradient(180deg,#FFFBF0,#FFFFFF)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-extrabold text-tinta">
          🎁 Tus recompensas
        </span>
        {listas > 0 && (
          <span className="rounded-full bg-[#FBF3DC] px-2.5 py-1 text-[11.5px] font-bold text-[#8A6D1E]">
            {listas} desbloqueada{listas === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {recompensas.map((r) => {
          const ok = r.estado === "desbloqueada";
          const bloq = r.estado === "bloqueada";
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-[14px] px-3 py-2.5"
              style={{
                background: ok ? "#F1FBF6" : "#F7F9FD",
                border: `1px solid ${ok ? "#C6E9D8" : "#EAEEF7"}`,
                opacity: bloq ? 0.75 : 1,
              }}
            >
              <span className="text-[20px]">{ok ? "🏅" : bloq ? "🔒" : "⏳"}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-extrabold text-tinta">{r.titulo}</span>
                  <span className="flex-shrink-0 text-[11px] font-semibold text-gris">{r.detalle}</span>
                </div>
                <span className="text-[12px] font-medium text-[#8A6D1E]">🎁 {r.premio}</span>
                {!ok && (
                  <div className="mt-0.5 h-[7px] w-full overflow-hidden rounded-full bg-[#E6ECFA]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#5B84F0,#2453DC)]"
                      style={{ width: `${Math.round(r.progreso * 100)}%` }}
                    />
                  </div>
                )}
                {ok && (
                  <span className="text-[11px] font-bold text-verde">
                    ¡Desbloqueada! Mostrásela al cobrador para aprovecharla.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

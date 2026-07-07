"use client";
// Morosidad del cliente (gestores): marca persistente de moroso (lista negra) +
// bitácora de motivos/acuerdos de pago. Anti-fraude: la marca queda entre
// créditos y avisa al renovar. Todo interno (no lo ve el cliente).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarMoroso, desmarcarMoroso, agregarNotaMora } from "@/lib/acciones/morosidad";
import type { EstadoMorosidad, NotaMora, TipoNotaMora } from "@/lib/data/morosidad";

const TIPO_LABEL: Record<TipoNotaMora, { label: string; bg: string; fg: string }> = {
  motivo: { label: "Motivo", bg: "#FDECE0", fg: "#C0562B" },
  acuerdo: { label: "Acuerdo", bg: "#EAF0FF", fg: "#1E47C8" },
  nota: { label: "Nota", bg: "#F1F3F9", fg: "#6B7494" },
};

function fecha(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function MorosidadCliente({
  clienteId,
  inicial,
  notas,
}: {
  clienteId: string;
  inicial: EstadoMorosidad;
  notas: NotaMora[];
}) {
  const router = useRouter();
  const [marcando, setMarcando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [tipoNota, setTipoNota] = useState<TipoNotaMora>("nota");
  const [textoNota, setTextoNota] = useState("");
  const [error, setError] = useState("");
  const [pendiente, startTransition] = useTransition();

  const marcar = () => {
    setError("");
    startTransition(async () => {
      const res = await marcarMoroso(clienteId, motivo);
      if (res.ok) {
        setMarcando(false);
        setMotivo("");
        router.refresh();
      } else setError(res.error);
    });
  };

  const desmarcar = () => {
    setError("");
    startTransition(async () => {
      const res = await desmarcarMoroso(clienteId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const agregar = () => {
    setError("");
    startTransition(async () => {
      const res = await agregarNotaMora(clienteId, tipoNota, textoNota);
      if (res.ok) {
        setTextoNota("");
        router.refresh();
      } else setError(res.error);
    });
  };

  return (
    <section
      className={`rounded-[16px] border p-4 ${
        inicial.moroso ? "border-[#F3C0B8] bg-[#FDF1EF]" : "border-[#E6EAF4] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-extrabold text-tinta">
            {inicial.moroso ? "⛔ Cliente MOROSO" : "Morosidad"}
          </span>
          {inicial.moroso ? (
            <span className="text-[12px] font-medium text-[#C0392B]">
              {inicial.motivo}
              {inicial.desde ? ` · desde ${fecha(inicial.desde)}` : ""}
              {inicial.porNombre ? ` · por ${inicial.porNombre}` : ""}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-gris">
              Sin marca. Marcalo si dejó deuda o no es confiable: queda entre créditos y avisa al renovar.
            </span>
          )}
        </div>
        {inicial.moroso ? (
          <button
            type="button"
            onClick={desmarcar}
            disabled={pendiente}
            className="flex-shrink-0 rounded-full border border-[#DCE3F4] px-3 py-1.5 text-[12px] font-bold text-gris disabled:opacity-50"
          >
            Quitar marca
          </button>
        ) : (
          !marcando && (
            <button
              type="button"
              onClick={() => setMarcando(true)}
              className="flex-shrink-0 rounded-full bg-[#D64545] px-3.5 py-1.5 text-[12px] font-bold text-white"
            >
              Marcar moroso
            </button>
          )
        )}
      </div>

      {/* Confirmación de marca con motivo */}
      {marcando && !inicial.moroso && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF1F8] pt-3">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            autoFocus
            placeholder="Motivo (dejó deuda, desapareció, documento dudoso…)"
            className="rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13px] outline-none focus:border-azul"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={marcar}
              disabled={pendiente}
              className="rounded-full bg-[#D64545] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {pendiente ? "Guardando…" : "Confirmar marca"}
            </button>
            <button
              type="button"
              onClick={() => setMarcando(false)}
              className="rounded-full border border-[#DCE3F4] px-3 py-2 text-[12.5px] font-bold text-gris"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Bitácora de motivos/acuerdos */}
      <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF1F8] pt-3">
        <span className="text-[11.5px] font-bold tracking-wide text-gris uppercase">
          Motivos y acuerdos de pago
        </span>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            {(["motivo", "acuerdo", "nota"] as TipoNotaMora[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoNota(t)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                  tipoNota === t ? "bg-[#2453DC] text-white" : "bg-[#F1F3F9] text-[#6B7494]"
                }`}
              >
                {TIPO_LABEL[t].label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={textoNota}
              onChange={(e) => setTextoNota(e.target.value)}
              maxLength={500}
              placeholder={
                tipoNota === "acuerdo"
                  ? "Acuerdo: paga $X el viernes…"
                  : tipoNota === "motivo"
                    ? "Motivo: perdió el trabajo, se mudó…"
                    : "Nota…"
              }
              className="flex-1 rounded-[10px] border border-[#DCE3F4] px-3 py-2 text-[13px] outline-none focus:border-azul"
            />
            <button
              type="button"
              onClick={agregar}
              disabled={pendiente || !textoNota.trim()}
              className="rounded-full bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </div>

        {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}

        {notas.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {notas.map((n) => {
              const t = TIPO_LABEL[n.tipo];
              return (
                <li key={n.id} className="flex items-start gap-2 rounded-[10px] bg-[#F9FBFF] px-2.5 py-2">
                  <span
                    className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    {t.label}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12.5px] font-medium text-tinta">{n.texto}</span>
                    <span className="text-[10.5px] font-medium text-[#8A93AD]">
                      {n.autorNombre ?? "—"} · {fecha(n.creadoEn)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-[11.5px] font-medium text-[#AEB6CC]">Sin notas de mora todavía.</span>
        )}
      </div>
    </section>
  );
}

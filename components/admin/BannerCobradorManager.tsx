"use client";
// Panel del gestor para enviar un BANNER a la app del cobrador (aviso fijo arriba
// de su ruta). Redactar + tema + vencimiento opcional, y apagar los activos.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearBannerCobrador, desactivarBannerCobrador } from "@/lib/acciones/bannerCobrador";
import type { BannerCobrador, TemaBanner } from "@/lib/data/bannerCobrador";

const TEMAS: { id: TemaBanner; label: string; bg: string; fg: string; bd: string }[] = [
  { id: "azul", label: "Info", bg: "#E9F0FF", fg: "#1E47C8", bd: "#C6D6FB" },
  { id: "verde", label: "Bien", bg: "#E4F5EC", fg: "#157A50", bd: "#BFE6D2" },
  { id: "ambar", label: "Atención", bg: "#FDF3E2", fg: "#B9770E", bd: "#F0D9A8" },
  { id: "rojo", label: "Urgente", bg: "#FBE4E2", fg: "#C0392B", bd: "#F3C0B8" },
];
const temaDe = (t: TemaBanner) => TEMAS.find((x) => x.id === t) ?? TEMAS[0];

const VENCE = [
  { label: "Sin vencimiento", horas: 0 },
  { label: "1 día", horas: 24 },
  { label: "3 días", horas: 72 },
  { label: "1 semana", horas: 168 },
];

export function BannerCobradorManager({ banners }: { banners: BannerCobrador[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [tema, setTema] = useState<TemaBanner>("azul");
  const [horas, setHoras] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const activos = banners.filter((b) => b.activo);

  const publicar = () => {
    if (texto.trim().length < 3 || pendiente) return;
    setError(null);
    startTransition(async () => {
      const res = await crearBannerCobrador({ texto, tema, expiraEnHoras: horas });
      if (res.ok) {
        setTexto("");
        setAbierto(false);
        router.refresh();
      } else setError(res.error);
    });
  };

  const apagar = (id: string) => {
    startTransition(async () => {
      await desactivarBannerCobrador(id);
      router.refresh();
    });
  };

  const prev = temaDe(tema);

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">📣 Banner al equipo</span>
          <span className="text-[11.5px] font-medium text-tenue">
            Un aviso fijo arriba de la ruta de todos los cobradores.
          </span>
        </div>
        {!abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-full bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white active:scale-[0.99]"
          >
            + Nuevo aviso
          </button>
        )}
      </div>

      {abierto && (
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-suave p-3">
          <textarea
            value={texto}
            maxLength={240}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            placeholder="Ej: Feriado el jueves, no se cobra. Rindan antes de las 18h."
            className="resize-none rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[13.5px] outline-none focus:border-azul"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {TEMAS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTema(t.id)}
                className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                style={
                  tema === t.id
                    ? { background: t.fg, color: "#fff" }
                    : { background: t.bg, color: t.fg }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={horas}
            onChange={(e) => setHoras(Number(e.target.value))}
            className="w-fit rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[12.5px] outline-none focus:border-azul"
          >
            {VENCE.map((v) => (
              <option key={v.horas} value={v.horas}>
                {v.label}
              </option>
            ))}
          </select>

          {/* Vista previa */}
          {texto.trim() && (
            <div
              className="rounded-[12px] border px-3 py-2 text-[12.5px] font-semibold"
              style={{ background: prev.bg, color: prev.fg, borderColor: prev.bd }}
            >
              {texto}
            </div>
          )}

          {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-full border border-borde bg-tarjeta px-4 py-2 text-[12.5px] font-bold text-gris"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={publicar}
              disabled={pendiente || texto.trim().length < 3}
              className="flex-1 rounded-full bg-[#1FA971] px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-40"
            >
              {pendiente ? "Publicando…" : "Publicar aviso"}
            </button>
          </div>
        </div>
      )}

      {/* Activos */}
      {activos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-gris">
            Activos ({activos.length})
          </span>
          {activos.map((b) => {
            const t = temaDe(b.tema);
            return (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-[10px] border px-3 py-2"
                style={{ background: t.bg, borderColor: t.bd }}
              >
                <span className="flex-1 text-[12.5px] font-semibold" style={{ color: t.fg }}>
                  {b.texto}
                </span>
                <button
                  type="button"
                  onClick={() => apagar(b.id)}
                  disabled={pendiente}
                  className="flex-shrink-0 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-gris disabled:opacity-40"
                >
                  Apagar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

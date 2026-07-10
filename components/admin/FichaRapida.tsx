"use client";
// Botón "ojito" + modal de vista rápida del cliente. Se usa en listas (Mora,
// Clientes) para ver lo esencial sin entrar al perfil completo. Carga bajo
// demanda vía Server Action (gateada por rol/zona).
import { useState, useTransition } from "react";
import Link from "next/link";
import { UYU } from "@/lib/format";
import { cargarFichaRapida } from "@/lib/acciones/fichaRapida";
import type { FichaRapida } from "@/lib/data/fichaRapida";

const BANDA: Record<string, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "#E4F5EC", fg: "#157A50" },
  bueno: { label: "Bueno", bg: "#EAF0FF", fg: "#1E47C8" },
  regular: { label: "Regular", bg: "#FDF3E2", fg: "#B9770E" },
  riesgo: { label: "Riesgo", bg: "#FBE4E2", fg: "#C0392B" },
  nuevo: { label: "Nuevo", bg: "#F2F0FA", fg: "#7A4DD6" },
};

function OjoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function FichaRapidaBoton({ clienteId }: { clienteId: string }) {
  const [open, setOpen] = useState(false);
  const [ficha, setFicha] = useState<FichaRapida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function abrir() {
    setOpen(true);
    setError(null);
    if (!ficha)
      start(async () => {
        const r = await cargarFichaRapida(clienteId);
        if (r.ok) setFicha(r.ficha);
        else setError(r.error);
      });
  }

  const banda = ficha ? (BANDA[ficha.calificacion] ?? BANDA.nuevo) : null;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title="Vista rápida"
        aria-label="Vista rápida del cliente"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-borde text-azul hover:bg-suave"
      >
        <OjoIcon />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-[440px] overflow-y-auto rounded-t-[20px] bg-tarjeta p-5 shadow-[0_16px_40px_rgba(19,48,140,0.3)] sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                {ficha?.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ficha.fotoUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded-[12px] object-cover" />
                ) : (
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[12px] bg-[#2453DC] text-[18px] font-black text-white">
                    {(ficha?.nombre ?? "?").trim().charAt(0).toUpperCase() || "—"}
                  </div>
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[16px] font-extrabold text-tinta">
                    {ficha?.nombre ?? (pending ? "Cargando…" : "Cliente")}
                  </span>
                  {banda && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: banda.bg, color: banda.fg }}>
                        {banda.label}
                      </span>
                      {ficha?.reportado && (
                        <span className="rounded-full bg-[#FBE4E2] px-2 py-0.5 text-[10.5px] font-bold text-[#C0392B]">Reportado</span>
                      )}
                      {ficha?.score && (
                        <span className="text-[11px] font-semibold text-gris">score {ficha.score.puntaje}/1000</span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="text-[20px] leading-none text-gris hover:text-tinta">
                ×
              </button>
            </div>

            {pending && !ficha && <p className="mt-4 text-[13px] font-medium text-gris">Cargando ficha…</p>}
            {error && <p className="mt-4 rounded-[10px] bg-[#FBE4E2] px-3 py-2 text-[12.5px] font-semibold text-[#C0392B]">{error}</p>}

            {ficha && (
              <>
                {/* Contacto */}
                <div className="mt-4 flex flex-col gap-1 rounded-[12px] bg-suave p-3 text-[12.5px]">
                  <Dato k="Documento" v={ficha.documento ?? "—"} />
                  <Dato k="Teléfono" v={ficha.telefono ?? "—"} />
                  <Dato k="Dirección" v={ficha.direccion ?? "—"} />
                  <Dato k="Cobrador" v={ficha.cobrador ?? "—"} />
                </div>

                {/* Créditos activos */}
                <div className="mt-3 flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Créditos activos</span>
                  {ficha.creditos.length === 0 ? (
                    <p className="text-[12.5px] font-medium text-gris">Sin crédito activo.</p>
                  ) : (
                    ficha.creditos.map((c, i) => (
                      <div key={i} className="rounded-[12px] border border-borde p-3">
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="font-semibold text-tinta">
                            Cuota {UYU(c.cuota)} × {c.totalDias} días
                          </span>
                          <span className="font-bold text-azul tabular-nums">{c.progresoPct}%</span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-linea">
                          <div className="h-full rounded-full bg-gradient-to-r from-[#34E0A1] to-[#1FA971]" style={{ width: `${Math.min(100, c.progresoPct)}%` }} />
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                          <Mini k="Saldo" v={UYU(c.saldo)} />
                          <Mini k="Deuda vencida" v={UYU(c.deudaVencida)} tono={c.deudaVencida > 0 ? "#C0392B" : undefined} />
                          <Mini k="Días atraso" v={String(c.atrasados)} tono={c.atrasados > 0 ? "#C0392B" : undefined} />
                        </div>
                        {c.proxima && <p className="mt-1.5 text-[11px] font-medium text-tenue">Próxima cuota: {c.proxima}</p>}
                      </div>
                    ))
                  )}
                </div>

                {/* Scoring y comportamiento (de esto dependen mora, renovación, premios) */}
                {ficha.score && (
                  <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-borde p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gris">
                        Scoring y comportamiento
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                        style={{
                          background: (BANDA[ficha.score.banda] ?? BANDA.nuevo).bg,
                          color: (BANDA[ficha.score.banda] ?? BANDA.nuevo).fg,
                        }}
                      >
                        {ficha.score.puntaje}/1000 · {(BANDA[ficha.score.banda] ?? BANDA.nuevo).label}
                      </span>
                    </div>

                    <p className="text-[12px] font-medium text-cuerpo">
                      💡 {ficha.score.recomendacion.resumen}
                      {ficha.score.recomendacion.montoSugerido != null && (
                        <> · sugerido <b>{UYU(ficha.score.recomendacion.montoSugerido)}</b></>
                      )}
                    </p>

                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <MiniScore k="Cumplimiento" v={`${ficha.score.metricas.cumplimientoPct}%`} />
                      <MiniScore k="Puntualidad" v={`${ficha.score.metricas.puntualidadPct}%`} />
                      <MiniScore k="Antigüedad" v={`${ficha.score.metricas.mesesComoCliente} m`} />
                      <MiniScore k="Créditos" v={`${ficha.score.metricas.creditosFinalizados}/${ficha.score.metricas.creditosTotales}`} />
                      <MiniScore k="Atraso hoy" v={`${ficha.score.metricas.diasAtrasoActual} d`} tono={ficha.score.metricas.diasAtrasoActual > 0 ? "#C0392B" : undefined} />
                      <MiniScore k="Incobrables" v={String(ficha.score.metricas.incobrables)} tono={ficha.score.metricas.incobrables > 0 ? "#C0392B" : undefined} />
                    </div>

                    <div className="flex flex-col gap-0.5 border-t border-linea pt-1.5">
                      {ficha.score.factores.map((f, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 flex-1 truncate text-gris">
                            {f.etiqueta} · {f.detalle}
                          </span>
                          <span
                            className="flex-shrink-0 font-bold tabular-nums"
                            style={{ color: f.sentido === "positivo" ? "#157A50" : f.sentido === "negativo" ? "#C0392B" : "#6B7494" }}
                          >
                            {f.puntos >= 0 ? "+" : ""}{f.puntos}
                          </span>
                        </div>
                      ))}
                    </div>
                    {!ficha.score.datosSuficientes && (
                      <p className="text-[10.5px] font-medium text-[#B9770E]">
                        ⚠ Historial corto: el puntaje aún no es confiable (evaluar a mano).
                      </p>
                    )}
                  </div>
                )}

                <Link
                  href={`/admin/clientes/${ficha.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-[12px] bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white"
                >
                  Ver ficha completa →
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-tenue">{k}</span>
      <span className="truncate text-right font-semibold text-cuerpo">{v}</span>
    </div>
  );
}

function Mini({ k, v, tono }: { k: string; v: string; tono?: string }) {
  return (
    <div className="flex flex-col rounded-[10px] bg-suave py-1.5">
      <span className="text-[13px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{v}</span>
      <span className="text-[9.5px] font-semibold text-tenue">{k}</span>
    </div>
  );
}

function MiniScore({ k, v, tono }: { k: string; v: string; tono?: string }) {
  return (
    <div className="flex flex-col rounded-[8px] bg-suave py-1">
      <span className="text-[12.5px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>{v}</span>
      <span className="text-[9px] font-semibold text-tenue">{k}</span>
    </div>
  );
}

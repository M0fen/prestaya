"use client";
// ─────────────────────────────────────────────────────────────────────────
//  Mini-CRM de cobranza (premium). El gestor registra qué hizo con un moroso y,
//  sobre todo, el COMPROMISO DE PAGO. El estado del compromiso NO se guarda: se
//  auto-verifica contra el libro inmutable de pagos (cumplió / vence hoy /
//  incumplió). Botón + modal, carga bajo demanda (Server Action gateada por zona).
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useTransition } from "react";
import { UYU, diasSemana, meses } from "@/lib/format";
import { registrarGestion, cargarGestionesCliente, type EntradaGestion } from "@/lib/acciones/gestionCobranza";
import type { Gestion, TipoGestion, EstadoCompromiso } from "@/lib/data/gestionesCobranza";

const TIPOS: { id: TipoGestion; label: string; icon: string }[] = [
  { id: "visita", label: "Visita", icon: "🚶" },
  { id: "llamada", label: "Llamada", icon: "📞" },
  { id: "compromiso", label: "Compromiso", icon: "🤝" },
  { id: "acuerdo", label: "Acuerdo", icon: "✍️" },
  { id: "mensaje", label: "Mensaje", icon: "💬" },
  { id: "ilocalizable", label: "No ubicado", icon: "👻" },
];

const ESTADO_COMP: Record<EstadoCompromiso, { label: string; icon: string; bg: string; fg: string }> = {
  cumplido: { label: "Cumplió", icon: "✓", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  vence_hoy: { label: "Vence hoy", icon: "⏳", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  incumplido: { label: "Incumplió", icon: "✕", bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  vigente: { label: "Vigente", icon: "•", bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
};

const ICONO_TIPO: Record<TipoGestion, string> = {
  visita: "🚶",
  llamada: "📞",
  mensaje: "💬",
  compromiso: "🤝",
  acuerdo: "✍️",
  ilocalizable: "👻",
  otro: "•",
};

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${diasSemana[dt.getDay()]} ${d} de ${meses[m - 1]}`;
}
function selloCorto(ts: string): string {
  const dt = new Date(ts);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${dt.getDate()} ${meses[dt.getMonth()].slice(0, 3)} · ${hh}:${mm}`;
}
/** 'YYYY-MM-DD' a N días de hoy (en la TZ del navegador; suficiente para atajos). */
function isoEn(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function GestionCobranzaBoton({
  clienteId,
  nombre,
  montoSugerido,
}: {
  clienteId: string;
  nombre: string;
  montoSugerido?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-3.5 py-2 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]"
      >
        <span className="text-[13px]">🤝</span> Gestionar
      </button>
      {open && (
        <ModalGestion clienteId={clienteId} nombre={nombre} montoSugerido={montoSugerido} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ModalGestion({
  clienteId,
  nombre,
  montoSugerido,
  onClose,
}: {
  clienteId: string;
  nombre: string;
  montoSugerido?: number;
  onClose: () => void;
}) {
  const [gestiones, setGestiones] = useState<Gestion[] | null>(null);
  const [cargando, cargar] = useTransition();
  const [guardando, guardar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState(false);

  // Form
  const [tipo, setTipo] = useState<TipoGestion>("visita");
  const [resultado, setResultado] = useState("");
  const [conCompromiso, setConCompromiso] = useState(false);
  const [monto, setMonto] = useState<string>(montoSugerido ? String(Math.round(montoSugerido)) : "");
  const [fecha, setFecha] = useState<string>(isoEn(1));

  // Carga inicial del timeline (una vez, al abrir el modal).
  useEffect(() => {
    cargar(async () => {
      const r = await cargarGestionesCliente(clienteId);
      if (r.ok) setGestiones(r.gestiones);
      else setError(r.error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  function enviar() {
    setError(null);
    const entrada: EntradaGestion = {
      clienteId,
      tipo: conCompromiso && tipo !== "compromiso" ? "compromiso" : tipo,
      resultado: resultado || null,
      montoCompromiso: conCompromiso ? Number(monto) : null,
      fechaCompromiso: conCompromiso ? fecha : null,
    };
    guardar(async () => {
      const r = await registrarGestion(entrada);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOkFlash(true);
      setResultado("");
      setConCompromiso(false);
      setTimeout(() => setOkFlash(false), 1800);
      const rr = await cargarGestionesCliente(clienteId);
      if (rr.ok) setGestiones(rr.gestiones);
    });
  }

  const montoNum = Number(monto);
  const compromisoValido = conCompromiso && montoNum > 0 && !!fecha;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto rounded-t-[22px] bg-app shadow-[0_20px_60px_rgba(15,27,61,0.45)] sm:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header premium */}
        <div className="relative overflow-hidden rounded-t-[22px] bg-[linear-gradient(150deg,#1E47C8_0%,#13308C_55%,#0F1B3D_100%)] px-5 pb-5 pt-5 text-white">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55">Gestión de cobranza</span>
              <span className="text-[19px] font-extrabold tracking-[-0.01em]">{nombre}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-[22px] leading-none text-white/70 hover:text-white">
              ×
            </button>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-white/60">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#34E0A1]" />
            Los compromisos se verifican solos contra el libro de pagos.
          </p>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* ── Registrar gestión ── */}
          <section className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gris">¿Qué hiciste?</span>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((t) => {
                const activo = tipo === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTipo(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                      activo ? "border-azul bg-azul-suave text-azul" : "border-borde bg-tarjeta text-gris hover:bg-suave"
                    }`}
                  >
                    <span>{t.icon}</span> {t.label}
                  </button>
                );
              })}
            </div>

            <textarea
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              placeholder="Resultado (opcional): qué dijo, qué se acordó…"
              rows={2}
              className="w-full resize-none rounded-[12px] border border-borde bg-app px-3 py-2.5 text-[13px] text-tinta placeholder:text-tenue focus:border-azul focus:outline-none"
            />

            {/* Compromiso de pago (el corazón) */}
            <button
              type="button"
              onClick={() => setConCompromiso((v) => !v)}
              className={`flex items-center justify-between rounded-[12px] border px-3.5 py-2.5 text-left transition-colors ${
                conCompromiso ? "border-verde-osc bg-verde-suave" : "border-dashed border-borde bg-app hover:bg-suave"
              }`}
            >
              <span className="flex items-center gap-2 text-[13px] font-bold text-tinta">
                🤝 Quedó un compromiso de pago
              </span>
              <span className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${conCompromiso ? "justify-end bg-[#1FA971]" : "justify-start bg-[#D6DCEA]"}`}>
                <span className="h-4 w-4 rounded-full bg-white shadow" />
              </span>
            </button>

            {conCompromiso && (
              <div className="flex flex-col gap-2.5 rounded-[12px] bg-verde-suave p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold text-[#157A50]">$</span>
                  <input
                    inputMode="numeric"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Monto prometido"
                    // text fijo oscuro (no el token text-tinta, que en modo oscuro
                    // se aclara a casi-blanco y desaparecía sobre el input blanco).
                    className="min-w-0 flex-1 rounded-[12px] border border-[#BFE6D3] bg-white px-3 py-2 text-[14px] font-bold tabular-nums text-[#0F1B3D] focus:border-verde-osc focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { d: 0, l: "Hoy" },
                    { d: 1, l: "Mañana" },
                    { d: 2, l: "En 2 días" },
                    { d: 7, l: "En 7 días" },
                  ].map((a) => {
                    const iso = isoEn(a.d);
                    const activo = fecha === iso;
                    return (
                      <button
                        key={a.d}
                        type="button"
                        onClick={() => setFecha(iso)}
                        className={`rounded-full px-3 py-1 text-[11.5px] font-bold transition-colors ${
                          activo ? "bg-[#1FA971] text-white" : "bg-white text-[#157A50] hover:bg-[#E4F5EC]"
                        }`}
                      >
                        {a.l}
                      </button>
                    );
                  })}
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="rounded-full border border-[#BFE6D3] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#157A50] focus:outline-none"
                  />
                </div>
                {compromisoValido && (
                  <p className="text-[12px] font-semibold text-[#157A50]">
                    Se compromete a pagar <b className="tabular-nums">{UYU(montoNum)}</b> · {fechaLarga(fecha)}
                  </p>
                )}
              </div>
            )}

            {error && <p className="rounded-[12px] bg-[#FBE4E2] px-3 py-2 text-[12.5px] font-semibold text-[#C0392B]">{error}</p>}

            <button
              type="button"
              onClick={enviar}
              disabled={guardando || (conCompromiso && !compromisoValido)}
              className="flex items-center justify-center gap-2 rounded-[12px] bg-[linear-gradient(120deg,#1E47C8,#13308C)] px-4 py-3 text-[13.5px] font-extrabold text-white transition-opacity disabled:opacity-50"
            >
              {guardando ? "Guardando…" : okFlash ? "✓ Registrado" : "Registrar gestión"}
            </button>
          </section>

          {/* ── Timeline ── */}
          <section className="flex flex-col gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Historial de gestiones</span>
            {cargando && !gestiones && <p className="text-[12.5px] font-medium text-gris">Cargando historial…</p>}
            {gestiones && gestiones.length === 0 && (
              <p className="rounded-[12px] border border-dashed border-borde bg-tarjeta px-4 py-6 text-center text-[12.5px] font-medium text-gris">
                Todavía no hay gestiones. La primera que registres arriba aparece acá.
              </p>
            )}
            {gestiones && gestiones.length > 0 && (
              <ol className="relative flex flex-col gap-3 pl-6">
                {/* línea del timeline */}
                <span className="absolute bottom-2 left-[9px] top-2 w-px bg-linea" aria-hidden />
                {gestiones.map((g) => (
                  <li key={g.id} className="relative">
                    <span className="absolute -left-6 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-app bg-tarjeta text-[9px] shadow-[0_0_0_1px_#E6EAF4]">
                      {ICONO_TIPO[g.tipo]}
                    </span>
                    <div className="rounded-[12px] border border-borde bg-tarjeta p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-extrabold text-tinta capitalize">{g.tipo}</span>
                        <span className="text-[10.5px] font-medium text-tenue tabular-nums">{selloCorto(g.creadoEn)}</span>
                      </div>
                      {g.resultado && <p className="mt-0.5 text-[12px] font-medium text-cuerpo">{g.resultado}</p>}
                      {g.montoCompromiso != null && g.estadoCompromiso && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[12px] bg-suave px-2.5 py-2">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                            style={{ background: ESTADO_COMP[g.estadoCompromiso].bg, color: ESTADO_COMP[g.estadoCompromiso].fg }}
                          >
                            {ESTADO_COMP[g.estadoCompromiso].icon} {ESTADO_COMP[g.estadoCompromiso].label}
                          </span>
                          <span className="text-[11.5px] font-semibold text-cuerpo tabular-nums">
                            Prometió {UYU(g.montoCompromiso)} · {fechaLarga(g.fechaCompromiso as string)}
                          </span>
                          <span className="text-[10.5px] font-medium text-tenue tabular-nums">
                            (pagó {UYU(g.pagadoDesde)} desde entonces)
                          </span>
                        </div>
                      )}
                      {g.gestorNombre && <p className="mt-1 text-[10.5px] font-medium text-tenue">por {g.gestorNombre}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

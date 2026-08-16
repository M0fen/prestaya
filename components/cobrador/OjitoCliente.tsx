"use client";
// Ojito del cobrador: un vistazo COMPACTO del cliente sin salir de la ruta.
// Se abre desde el botón 👁 de cada fila. Carga bajo demanda (Server Action con
// RLS). Aparece plegado (solo lo esencial); "Últimos pagos" y "Notas" se
// despliegan al tocar, para no ocupar espacio. Da acciones directas al oficio:
// llamar, WhatsApp y abrir la ficha completa.
import { useState, useTransition } from "react";
import Link from "next/link";
import { UYU } from "@/lib/format";
import { peekClienteCobrador, type PeekCliente } from "@/lib/acciones/fichaCobrador";

const CALIF: Record<string, { label: string; bg: string; fg: string }> = {
  excelente: { label: "Excelente", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  bueno: { label: "Buen pagador", bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
  regular: { label: "Regular", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  riesgo: { label: "Riesgo", bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  nuevo: { label: "Nuevo", bg: "var(--color-violeta-suave)", fg: "var(--color-violeta-osc)" },
};

/** Teléfono → solo dígitos, para tel: y wa.me. */
const soloDigitos = (t: string) => t.replace(/\D/g, "");

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-UY", { day: "2-digit", month: "short" });
}

export function OjitoCliente({ clienteId, nombre }: { clienteId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [ficha, setFicha] = useState<PeekCliente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verPagos, setVerPagos] = useState(false);
  const [verNotas, setVerNotas] = useState(false);
  const [cargando, startTransition] = useTransition();

  const abrir = (e: React.MouseEvent) => {
    e.preventDefault(); // no navegar al detalle (el botón vive dentro de la fila)
    e.stopPropagation();
    setAbierto(true);
    setError(null);
    setVerPagos(false);
    setVerNotas(false);
    startTransition(async () => {
      const res = await peekClienteCobrador(clienteId);
      if (res.ok) setFicha(res.ficha);
      else setError(res.error);
    });
  };

  const cerrar = () => setAbierto(false);
  const cal = ficha?.calificacion ? CALIF[ficha.calificacion] : null;
  const tel = ficha?.telefono ? soloDigitos(ficha.telefono) : "";

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label={`Vistazo de ${nombre}`}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-linea text-[16px] active:scale-90"
        style={{ transition: "transform .1s" }}
      >
        👁
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={cerrar}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-[460px] flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-tarjeta p-4 pb-6 sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="line-clamp-2 break-words leading-[1.2] text-[17px] font-extrabold text-tinta">{nombre}</span>
                {ficha?.direccion && (
                  <span className="truncate text-[12px] font-medium text-tenue">{ficha.direccion}</span>
                )}
              </div>
              <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-linea text-[15px] font-bold text-gris"
              >
                ✕
              </button>
            </div>

            {cargando && !ficha && (
              <p className="py-6 text-center text-[13px] font-medium text-gris">Cargando…</p>
            )}
            {error && (
              <p className="rounded-[12px] bg-rojo-suave px-3 py-2.5 text-[12.5px] font-semibold text-rojo-osc">
                {error}
              </p>
            )}

            {ficha && (
              <>
                {/* Calificación + contacto */}
                <div className="flex flex-wrap items-center gap-2">
                  {cal && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{ background: cal.bg, color: cal.fg }}
                    >
                      {cal.label}
                    </span>
                  )}
                  {ficha.telefono ? (
                    <div className="flex gap-1.5">
                      <a
                        href={`tel:${ficha.telefono}`}
                        className="rounded-full bg-azul-suave px-3 py-1 text-[12px] font-bold text-azul"
                      >
                        📞 Llamar
                      </a>
                      <a
                        href={`https://wa.me/${tel}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-verde-suave px-3 py-1 text-[12px] font-bold text-verde-osc"
                      >
                        WhatsApp
                      </a>
                    </div>
                  ) : (
                    <span className="text-[11.5px] font-medium text-tenue">Sin teléfono cargado</span>
                  )}
                </div>

                {ficha.tieneCredito ? (
                  <>
                    {/* Esenciales (siempre visibles, compactos). Con más de un
                        crédito los números son la SUMA de todos: se avisa, para
                        que la cifra no sorprenda contra la ficha. */}
                    {ficha.creditos > 1 && (
                      <span className="rounded-[12px] bg-azul-suave px-2.5 py-1.5 text-[11.5px] font-bold text-azul">
                        Tiene {ficha.creditos} créditos con vos — los números son el total de los {ficha.creditos}.
                      </span>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <Dato label={ficha.creditos > 1 ? "Cuota total" : "Cuota"} valor={UYU(ficha.cuota)} />
                      <Dato label="Saldo" valor={UYU(ficha.saldo)} tono="var(--color-ambar-osc)" />
                      <Dato label="Avance" valor={`${ficha.progresoPct}%`} tono="var(--color-verde-osc)" />
                    </div>
                    <div className="flex items-center justify-between rounded-[12px] bg-suave px-3 py-2 text-[12px] font-semibold text-cuerpo">
                      <span>Días cubiertos: <b className="text-tinta">{ficha.diasCubiertos}/{ficha.totalDias}</b></span>
                      <span className={ficha.pagadoHoy > 0 ? "text-verde-osc" : "text-gris"}>
                        Hoy: <b>{ficha.pagadoHoy > 0 ? UYU(ficha.pagadoHoy) : "sin pago"}</b>
                      </span>
                    </div>

                    {/* Últimos pagos — plegado */}
                    <Plegable
                      titulo={`Últimos pagos${ficha.ultimosPagos.length ? ` (${ficha.ultimosPagos.length})` : ""}`}
                      abierto={verPagos}
                      onToggle={() => setVerPagos((v) => !v)}
                    >
                      {ficha.ultimosPagos.length === 0 ? (
                        <p className="text-[12px] font-medium text-gris">Sin pagos registrados.</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {ficha.ultimosPagos.map((p, i) => (
                            <li key={i} className="flex items-center justify-between text-[12.5px]">
                              <span className="font-medium text-cuerpo">{fechaCorta(p.fecha)}</span>
                              <span className="font-bold text-verde-osc tabular-nums">{UYU(p.monto)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Plegable>
                  </>
                ) : (
                  /* ⚠️ Antes decía "El alta la hace la oficina" — falso desde el
                     08-13: el cobrador coloca directo (y el primer crédito
                     también). El texto viejo mandaba a llamar por teléfono por
                     algo que se hace en dos toques. */
                  <a
                    href={`/cobrador/colocar?modo=venta&cliente=${clienteId}`}
                    className="block rounded-[12px] bg-verde-suave px-3 py-2.5 text-[12.5px] font-bold text-verde-osc active:scale-[0.99]"
                  >
                    Sin crédito activo. 💵 Podés darle uno ahora mismo →
                  </a>
                )}

                {/* Notas — plegado */}
                <Plegable
                  titulo={`Notas${ficha.notasCount ? ` (${ficha.notasCount})` : ""}`}
                  abierto={verNotas}
                  onToggle={() => setVerNotas((v) => !v)}
                >
                  {ficha.notasCount === 0 ? (
                    <p className="text-[12px] font-medium text-gris">Sin notas todavía.</p>
                  ) : (
                    <p className="text-[12.5px] leading-[1.5] font-medium text-cuerpo">
                      {ficha.ultimaNota}
                      {ficha.notasCount > 1 && (
                        <span className="text-tenue"> · +{ficha.notasCount - 1} nota(s) más</span>
                      )}
                    </p>
                  )}
                </Plegable>

                <Link
                  href={`/cobrador/cliente/${clienteId}`}
                  className="mt-1 btn-primario px-4 py-2.5 text-center text-[13px] font-extrabold text-white active:scale-[0.99]"
                  style={{ transition: "transform .1s" }}
                >
                  Abrir ficha completa →
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Dato({ label, valor, tono }: { label: string; valor: string; tono?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] bg-suave px-3 py-2">
      <span className="text-[10.5px] font-semibold text-tenue">{label}</span>
      <span className="text-[15px] font-extrabold tabular-nums" style={{ color: tono ?? "var(--color-tinta)" }}>
        {valor}
      </span>
    </div>
  );
}

/** Sección plegable (compacta por defecto). El header es un botón. */
function Plegable({
  titulo,
  abierto,
  onToggle,
  children,
}: {
  titulo: string;
  abierto: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-borde">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-[12.5px] font-bold text-tinta"
      >
        <span>{titulo}</span>
        <span className={`text-[11px] text-gris transition-transform ${abierto ? "rotate-90" : ""}`}>▶</span>
      </button>
      {abierto && <div className="border-t border-linea px-3 py-2.5">{children}</div>}
    </div>
  );
}

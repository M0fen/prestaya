// Alerta temprana de mora (admin/supervisor): clientes del crédito activo que
// se están yendo a mora, ANTES del castigo. Todo derivado del comportamiento de
// pago (lib/alerta.ts). Ordenados por urgencia, con contacto directo para actuar.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getTableroMora } from "@/lib/data/mora";
import { getMorosos } from "@/lib/data/morosidad";
import type { NivelRiesgo, TendenciaMora } from "@/types/alerta";
import { UYU } from "@/lib/format";
import { hrefSeguro } from "@/lib/seguridad";
import { FormPoliticaMora } from "@/components/admin/FormPoliticaMora";
import { FichaRapidaBoton } from "@/components/admin/FichaRapida";
import { GestionCobranzaBoton } from "@/components/admin/GestionCobranza";
import { getEstadoGestionClientes, type EstadoGestionCliente } from "@/lib/data/gestionesCobranza";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

// Un agregado colgado LANZA → error.tsx del panel ("Reintentar"), no un 504.
const TOPE_MS = 22_000;

// Tintes por token (var CSS): en oscuro flipean solos a superficie oscura + texto claro.
const NIVEL: Record<NivelRiesgo, { label: string; bg: string; fg: string }> = {
  critico: { label: "Crítico", bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  alto: { label: "Alto", bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)" },
  medio: { label: "Medio", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  sano: { label: "Al día", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
};

const TENDENCIA: Record<TendenciaMora, string> = {
  empeorando: "↘ empeorando",
  estable: "→ estable",
  mejorando: "↗ mejorando",
};

/** Deja solo dígitos y arma el link de WhatsApp (Uruguay: prefijo 598). */
function waLink(telefono: string): string {
  const d = telefono.replace(/\D/g, "");
  const conPais = d.startsWith("598") ? d : `598${d.replace(/^0+/, "")}`;
  return `https://wa.me/${conPais}`;
}

export default async function MoraPage({
  searchParams,
}: {
  searchParams: Promise<{ cob?: string; nivel?: string }>;
}) {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const [{ resumen, config, enRiesgo }, morosos] = await conTimeout(
    Promise.all([getTableroMora(db), getMorosos(db)]),
    TOPE_MS,
    "admin.mora",
  );
  const conMora = config.modo !== "off";

  // Estado de gestión (mini-CRM) por cliente en riesgo: si ya se gestionó hoy y si
  // hay un compromiso de pago abierto. Enciende el loop de cobranza sobre la lista.
  const estadosGestion = await conTimeout(
    getEstadoGestionClientes(db, enRiesgo.map((c) => c.clienteId)),
    TOPE_MS,
    "admin.mora.gestion",
  );

  // Filtro "modo ruta": por cobrador y por nivel, para aislar la lista de un
  // cobrador y mandársela. GET (sin JS). Los KPIs de arriba siguen siendo del total.
  const sp = await searchParams;
  const filtroCob = sp.cob || null;
  const nivelesFiltrables: NivelRiesgo[] = ["critico", "alto", "medio"];
  const filtroNivel = nivelesFiltrables.includes((sp.nivel ?? "") as NivelRiesgo)
    ? (sp.nivel as NivelRiesgo)
    : null;
  const cobradoresEnRiesgo = [
    ...new Map(
      enRiesgo.filter((c) => c.cobradorId).map((c) => [c.cobradorId as string, c.cobradorNombre ?? "—"]),
    ).entries(),
  ]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const enRiesgoFiltrado = enRiesgo.filter(
    (c) => (!filtroCob || c.cobradorId === filtroCob) && (!filtroNivel || c.alerta.nivel === filtroNivel),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">
          Alerta de mora
        </h1>
        <span className="text-[13px] font-medium text-gris">
          Clientes que se están atrasando — a quién visitar antes de que se
          complique.
        </span>
      </div>

      {/* Política de mora (recargo por atraso, configurable). Solo el admin la edita. */}
      <FormPoliticaMora config={config} puedeEditar={esAdmin(usuario.rol)} />

      {conMora && resumen.recargoTotal > 0 && (
        <div className="flex items-center justify-between rounded-[12px] panel-ambar px-4 py-2.5">
          <span className="text-[12.5px] font-bold text-ambar-osc">Recargo por mora sugerido (cartera en riesgo)</span>
          <span className="text-[15px] font-extrabold tabular-nums text-ambar-osc">{UYU(resumen.recargoTotal)}</span>
        </div>
      )}

      {/* Resumen por nivel */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Crítico" valor={resumen.critico} color="var(--color-rojo-osc)" />
        <Kpi label="Alto" valor={resumen.alto} color="var(--color-rojo-osc)" />
        <Kpi label="Medio" valor={resumen.medio} color="var(--color-ambar-osc)" />
        <Kpi label="Deuda en riesgo" valor={UYU(resumen.deudaEnRiesgo)} money />
      </div>

      {/* Cartera vencida: créditos cuyo PLAZO ya terminó e impagos. NO es mora del
          día (deuda de castigo) — se muestra aparte para no inflar el riesgo. */}
      {resumen.vencidos > 0 && (
        <div className="flex items-center justify-between rounded-[12px] panel-ambar px-4 py-2.5">
          <span className="text-[12.5px] font-bold text-ambar-osc">
            Cartera vencida · {resumen.vencidos} crédito{resumen.vencidos === 1 ? "" : "s"} de plazo terminado e impagos (gestionar / castigar, aparte de la mora)
          </span>
          <span className="text-[15px] font-extrabold tabular-nums text-ambar-osc">{UYU(resumen.carteraVencida)}</span>
        </div>
      )}

      {/* Morosos: lista negra (marcados) + castigos (incobrables). Persisten
          entre créditos, a diferencia de la alerta temprana de arriba. */}
      {morosos.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="text-[12px] font-bold tracking-[0.03em] text-gris uppercase">
            Morosos · lista negra y castigos ({morosos.length})
          </span>
          <ul className="flex flex-col divide-y divide-[#F6DAD4] overflow-hidden rounded-[16px] border border-[#F3C0B8] bg-tarjeta">
            {morosos.map((m) => (
              <li key={m.clienteId} className="flex items-center gap-3 px-3.5 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/admin/clientes/${m.clienteId}`}
                    className="line-clamp-2 break-words leading-[1.2] text-[14px] font-bold text-tinta hover:text-azul"
                  >
                    {m.nombre}
                  </Link>
                  <span className="truncate text-[12px] font-medium text-gris">
                    {m.marcado ? (m.motivo ?? "Marcado como moroso") : "Con crédito incobrable"}
                    {m.incobrables > 0 ? ` · ${m.incobrables} incobrable${m.incobrables === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  {m.marcado && (
                    <span className="rounded-full bg-rojo-suave px-2.5 py-1 text-[11px] font-bold text-rojo-osc">
                      Lista negra
                    </span>
                  )}
                  {m.incobrables > 0 && (
                    <span className="rounded-full bg-rojo-suave px-2.5 py-1 text-[11px] font-bold text-rojo-osc">
                      Castigo
                    </span>
                  )}
                  <FichaRapidaBoton clienteId={m.clienteId} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {enRiesgo.length === 0 && (
        <p className="rounded-[14px] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          {resumen.activos === 0
            ? "No hay créditos activos para evaluar."
            : resumen.vencidos > 0
              ? "Sin créditos en término en riesgo hoy. (Queda cartera vencida por gestionar, arriba.)"
              : "Nadie en riesgo hoy: toda la cartera activa está al día. 🎉"}
        </p>
      )}

      {/* Filtro por cobrador y nivel: arma la lista de cada cobrador para enviársela. */}
      {enRiesgo.length > 0 && (
        <form
          method="get"
          className="flex flex-wrap items-end gap-2 rounded-[14px] border border-borde bg-tarjeta p-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gris">Cobrador</span>
            <select name="cob" defaultValue={filtroCob ?? ""} className={INPUT}>
              <option value="">Todos</option>
              {cobradoresEnRiesgo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gris">Nivel</span>
            <select name="nivel" defaultValue={filtroNivel ?? ""} className={INPUT}>
              <option value="">Todos</option>
              <option value="critico">Crítico</option>
              <option value="alto">Alto</option>
              <option value="medio">Medio</option>
            </select>
          </label>
          <button type="submit" className="btn-primario px-4 py-2 text-[13px] font-bold text-white">
            Filtrar
          </button>
          {(filtroCob || filtroNivel) && (
            <Link
              href="/admin/mora"
              className="rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[13px] font-bold text-gris"
            >
              Limpiar
            </Link>
          )}
          <span className="ml-auto self-center text-[12px] font-semibold text-gris tabular-nums">
            {enRiesgoFiltrado.length} de {enRiesgo.length}
          </span>
        </form>
      )}

      {enRiesgo.length > 0 && enRiesgoFiltrado.length === 0 && (
        <p className="rounded-[14px] bg-tarjeta px-4 py-6 text-center text-[13px] font-medium text-gris">
          Ningún cliente en riesgo con ese filtro.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {enRiesgoFiltrado.map((c) => {
          const nivel = NIVEL[c.alerta.nivel];
          const s = c.alerta.senales;
          return (
            <section
              key={c.clienteId}
              className="rounded-[16px] border border-borde bg-tarjeta p-4"
            >
              <div className="mb-2 flex items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[12px] avatar-marca text-[16px] font-black text-white">
                  {c.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/admin/clientes/${c.clienteId}`}
                    className="line-clamp-2 break-words leading-[1.2] text-[15px] font-extrabold text-tinta hover:text-azul"
                  >
                    {c.nombre}
                  </Link>
                  <span className="truncate text-[12px] font-medium text-gris">
                    {c.direccion ?? "Sin dirección"}
                    {c.cobradorNombre ? ` · ${c.cobradorNombre}` : ""}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: nivel.bg, color: nivel.fg }}
                  >
                    {nivel.label} · {c.alerta.riesgo}
                  </span>
                  <FichaRapidaBoton clienteId={c.clienteId} />
                </div>
              </div>

              {/* Señales clave */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Chip texto={`${s.rachaAtraso} días sin cubrir`} activo={s.rachaAtraso >= 2} />
                <Chip texto={`${s.diasSinPagar} días sin pagar`} activo={s.diasSinPagar >= 3} />
                <Chip texto={`${s.atrasosTotales} cuotas vencidas`} activo={s.atrasosTotales >= 3} />
                <Chip texto={TENDENCIA[c.alerta.tendencia]} activo={c.alerta.tendencia === "empeorando"} />
                <GestionEstadoChip estado={estadosGestion.get(c.clienteId)} />
              </div>

              {/* Acción + deuda */}
              <div className="flex items-center justify-between gap-3 rounded-[12px] bg-suave p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] font-bold text-tinta">
                    {c.alerta.accionSugerida}
                  </span>
                  <span className="text-[12px] font-medium text-gris">
                    Deuda vencida: {UYU(s.montoVencido)}
                    {conMora && c.recargoMora > 0 && (
                      <span className="font-bold text-ambar-osc"> · +{UYU(c.recargoMora)} mora</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                  {/* Registrar gestión / compromiso de pago (mini-CRM de cobranza). */}
                  <GestionCobranzaBoton clienteId={c.clienteId} nombre={c.nombre} montoSugerido={s.montoVencido} />
                  {/* Dejar un mensaje en el chat (al hilo del cobrador que la tiene
                      asignada) para mandarlo a cobrar. No se llama al cliente. */}
                  <Link
                    href={c.cobradorId ? `/admin/chat?c=cob:${c.cobradorId}` : "/admin/chat"}
                    className="btn-primario px-3.5 py-2 text-[12.5px] font-bold text-white"
                  >
                    💬 {c.cobradorId ? "Mensaje al cobrador" : "Dejar mensaje"}
                  </Link>
                  {c.telefono && (
                    <a
                      href={hrefSeguro(waLink(c.telefono)) ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-[#1FA971] px-3.5 py-2 text-[12.5px] font-bold text-white"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] leading-[1.5] font-medium text-tenue-2">
        El riesgo se calcula solo con el comportamiento de pago del crédito
        activo (racha de atraso, recencia y tendencia). Es una guía de prioridad
        de cobranza, no se le muestra al cliente.
      </p>
    </div>
  );
}

const INPUT =
  "rounded-[12px] border border-borde bg-tarjeta px-3 py-2 text-[16px] text-tinta outline-none focus:border-azul";

function Kpi({
  label,
  valor,
  color,
  money = false,
}: {
  label: string;
  valor: number | string;
  /** Color del número (token var que flipea en dark). El de "money" usa tinta. */
  color?: string;
  money?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] bg-tarjeta p-3.5 shadow-sm">
      <span className="text-[11px] font-semibold text-tenue">{label}</span>
      <span
        className={`font-extrabold text-tinta tabular-nums ${money ? "text-[16px]" : "text-[22px]"}`}
        style={money ? undefined : { color }}
      >
        {valor}
      </span>
    </div>
  );
}

/** Chip del estado de gestión (mini-CRM) sobre la fila de mora: prioriza el
 *  compromiso de pago abierto; si no, muestra si ya se gestionó hoy. */
function GestionEstadoChip({ estado }: { estado?: EstadoGestionCliente }) {
  if (!estado) return null;
  if (estado.compromiso) {
    const c = estado.compromiso;
    const tono =
      c.estado === "incumplido"
        ? { bg: "var(--color-rojo-suave)", fg: "var(--color-rojo-osc)", txt: "incumplió" }
        : c.estado === "vence_hoy"
          ? { bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)", txt: "vence hoy" }
          : { bg: "var(--color-azul-suave)", fg: "var(--color-azul)", txt: "vigente" };
    return (
      <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums" style={{ background: tono.bg, color: tono.fg }}>
        🤝 {UYU(c.monto)} · {tono.txt}
      </span>
    );
  }
  if (estado.gestionadoHoy)
    return <span className="rounded-full bg-verde-suave px-2.5 py-1 text-[11px] font-bold text-verde-osc">✓ Gestionado hoy</span>;
  return null;
}

function Chip({ texto, activo }: { texto: string; activo: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        activo ? "bg-rojo-suave text-rojo-osc" : "bg-linea text-tenue"
      }`}
    >
      {texto}
    </span>
  );
}

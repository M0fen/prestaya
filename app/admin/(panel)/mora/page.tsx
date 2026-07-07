// Alerta temprana de mora (admin/supervisor): clientes del crédito activo que
// se están yendo a mora, ANTES del castigo. Todo derivado del comportamiento de
// pago (lib/alerta.ts). Ordenados por urgencia, con contacto directo para actuar.
import Link from "next/link";
import { requireGestor, esAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getTableroMora } from "@/lib/data/mora";
import type { NivelRiesgo, TendenciaMora } from "@/types/alerta";
import { UYU } from "@/lib/format";
import { hrefSeguro } from "@/lib/seguridad";
import { FormPoliticaMora } from "@/components/admin/FormPoliticaMora";

export const dynamic = "force-dynamic";

const NIVEL: Record<NivelRiesgo, { label: string; bg: string; fg: string }> = {
  critico: { label: "Crítico", bg: "#FBE4E2", fg: "#C0392B" },
  alto: { label: "Alto", bg: "#FDECE0", fg: "#C0562B" },
  medio: { label: "Medio", bg: "#FDF3E2", fg: "#B9770E" },
  sano: { label: "Al día", bg: "#E4F5EC", fg: "#157A50" },
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

export default async function MoraPage() {
  const usuario = await requireGestor();
  const db = await createSupabaseServer();
  const { resumen, config, enRiesgo } = await getTableroMora(db);
  const conMora = config.modo !== "off";

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
        <div className="flex items-center justify-between rounded-[12px] bg-[#FDF3E2] px-4 py-2.5">
          <span className="text-[12.5px] font-bold text-[#B9770E]">Recargo por mora sugerido (cartera en riesgo)</span>
          <span className="text-[15px] font-extrabold tabular-nums text-[#B9770E]">{UYU(resumen.recargoTotal)}</span>
        </div>
      )}

      {/* Resumen por nivel */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Kpi label="Crítico" valor={resumen.critico} tono={NIVEL.critico} />
        <Kpi label="Alto" valor={resumen.alto} tono={NIVEL.alto} />
        <Kpi label="Medio" valor={resumen.medio} tono={NIVEL.medio} />
        <Kpi label="Deuda en riesgo" valor={UYU(resumen.deudaEnRiesgo)} tono={NIVEL.medio} money />
      </div>

      {enRiesgo.length === 0 && (
        <p className="rounded-[14px] bg-white px-4 py-6 text-center text-[13px] font-medium text-gris">
          {resumen.activos === 0
            ? "No hay créditos activos para evaluar."
            : "Nadie en riesgo hoy: toda la cartera activa está al día. 🎉"}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {enRiesgo.map((c) => {
          const nivel = NIVEL[c.alerta.nivel];
          const s = c.alerta.senales;
          return (
            <section
              key={c.clienteId}
              className="rounded-[16px] border border-[#E6EAF4] bg-white p-4"
            >
              <div className="mb-2 flex items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-[#2453DC] text-[16px] font-black text-white">
                  {c.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/admin/clientes/${c.clienteId}`}
                    className="truncate text-[15px] font-extrabold text-tinta hover:text-azul"
                  >
                    {c.nombre}
                  </Link>
                  <span className="truncate text-[12px] font-medium text-gris">
                    {c.direccion ?? "Sin dirección"}
                    {c.cobradorNombre ? ` · ${c.cobradorNombre}` : ""}
                  </span>
                </div>
                <span
                  className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: nivel.bg, color: nivel.fg }}
                >
                  {nivel.label} · {c.alerta.riesgo}
                </span>
              </div>

              {/* Señales clave */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Chip texto={`${s.rachaAtraso} días sin cubrir`} activo={s.rachaAtraso >= 2} />
                <Chip texto={`${s.diasSinPagar} días sin pagar`} activo={s.diasSinPagar >= 3} />
                <Chip texto={`${s.atrasosTotales} cuotas vencidas`} activo={s.atrasosTotales >= 3} />
                <Chip texto={TENDENCIA[c.alerta.tendencia]} activo={c.alerta.tendencia === "empeorando"} />
              </div>

              {/* Acción + deuda */}
              <div className="flex items-center justify-between gap-3 rounded-[12px] bg-[#F7F9FD] p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] font-bold text-tinta">
                    {c.alerta.accionSugerida}
                  </span>
                  <span className="text-[12px] font-medium text-gris">
                    Deuda vencida: {UYU(s.deudaVencida)}
                    {conMora && c.recargoMora > 0 && (
                      <span className="font-bold text-[#B9770E]"> · +{UYU(c.recargoMora)} mora</span>
                    )}
                  </span>
                </div>
                {c.telefono && (
                  <div className="flex flex-shrink-0 gap-2">
                    <a
                      href={hrefSeguro(`tel:${c.telefono}`) ?? "#"}
                      className="rounded-full bg-[#2453DC] px-3.5 py-2 text-[12.5px] font-bold text-white"
                    >
                      Llamar
                    </a>
                    <a
                      href={hrefSeguro(waLink(c.telefono)) ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-[#1FA971] px-3.5 py-2 text-[12.5px] font-bold text-white"
                    >
                      WhatsApp
                    </a>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] leading-[1.5] font-medium text-[#AEB6CC]">
        El riesgo se calcula solo con el comportamiento de pago del crédito
        activo (racha de atraso, recencia y tendencia). Es una guía de prioridad
        de cobranza, no se le muestra al cliente.
      </p>
    </div>
  );
}

function Kpi({
  label,
  valor,
  tono,
  money = false,
}: {
  label: string;
  valor: number | string;
  tono: { bg: string; fg: string };
  money?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] bg-white p-3.5 shadow-[0_1px_3px_rgba(26,34,71,0.05)]">
      <span className="text-[11px] font-semibold text-[#8A93AD]">{label}</span>
      <span
        className={`font-extrabold text-tinta tabular-nums ${money ? "text-[16px]" : "text-[22px]"}`}
        style={money ? undefined : { color: tono.fg }}
      >
        {valor}
      </span>
    </div>
  );
}

function Chip({ texto, activo }: { texto: string; activo: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        activo ? "bg-[#FBE4E2] text-[#C0392B]" : "bg-[#EEF1F8] text-[#8A93AD]"
      }`}
    >
      {texto}
    </span>
  );
}

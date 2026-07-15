// TRAZABILIDAD DEL EMPALME — para admin (Mauro/Carolina) y dev (Carlos): revisar
// cada DIFERENCIA de dinero entre lo que muestra la app y el libro de pagos, +
// el kill switch de emergencia. Se alimenta del RPC 0071 (reconciliación).
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getInfoEmpalme } from "@/lib/data/reconciliacion";
import { KillSwitch } from "@/components/admin/KillSwitch";
import { UYU } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EmpalmePage() {
  await requireAdmin();
  const db = createSupabaseAdmin();
  const info = await getInfoEmpalme(db);

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-tinta">Empalme y reconciliación</h1>
        <span className="text-[13px] font-medium text-gris">
          Trazabilidad de las diferencias de dinero entre la app y el libro de pagos. La reconciliación
          corre cada mañana (07:00) y avisa por push si aparece algo crítico nuevo.
        </span>
      </div>

      <KillSwitch activo={info.soloLectura} />

      {!info.disponible ? (
        <section className="rounded-[16px] border border-[#F0D9A8] bg-[#FEFBF3] px-4 py-6 text-center">
          <span className="text-[13px] font-bold text-[#9A6A0E]">Reconciliación no disponible.</span>
          <p className="mt-1 text-[12px] font-medium text-[#9A6A0E]">
            Falta correr la migración 0071 (RPC de reconciliación).
          </p>
        </section>
      ) : (
        <>
          {/* Resumen */}
          <section className="grid grid-cols-3 gap-2.5">
            <Kpi
              label="Diferencias"
              valor={String(info.totalDiferencias)}
              tono={info.totalDiferencias === 0 ? "#157A50" : "#6B7494"}
            />
            <Kpi
              label="Críticas (revisar)"
              valor={String(info.criticas)}
              tono={info.criticas === 0 ? "#157A50" : "#C0392B"}
            />
            <Kpi
              label="Estado"
              valor={info.criticas === 0 ? "Sano" : "Atención"}
              tono={info.criticas === 0 ? "#157A50" : "#C0392B"}
            />
          </section>

          {info.totalDiferencias === 0 ? (
            <section className="rounded-[16px] border border-[#CFEBDD] bg-[#F1FBF6] px-4 py-6 text-center">
              <span className="text-[13px] font-bold text-[#157A50]">✅ La plata cuadra: cero diferencias.</span>
            </section>
          ) : (
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-0.5">
                <h2 className="text-[15px] font-extrabold text-tinta">Detalle de las diferencias</h2>
                <span className="text-[11.5px] font-medium text-gris">
                  {info.criticas} materiales · {info.totalDiferencias - info.criticas} de redondeo (baseline)
                </span>
              </div>
              <div className="overflow-x-auto rounded-[14px] border border-[#E6EAF4] bg-white">
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#EEF1F8] text-left text-[11px] font-bold tracking-wide text-gris uppercase">
                      <th className="px-3 py-2.5">Cliente</th>
                      <th className="px-3 py-2.5">Tipo</th>
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5 text-right">Saldo app</th>
                      <th className="px-3 py-2.5 text-right">Libro (Σpagos)</th>
                      <th className="px-3 py-2.5 text-right">Total</th>
                      <th className="px-3 py-2.5 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.diferencias.map((d) => {
                      const dif = d.tipo === "drift" ? d.drift : d.exceso;
                      return (
                        <tr key={d.creditoId} className="border-b border-[#F2F5FB] last:border-0">
                          <td className="px-3 py-2.5">
                            <span className="font-bold text-tinta">{d.clienteNombre}</span>
                            <span className="ml-1 text-[10.5px] text-[#AEB6CC]">#{d.creditoId.slice(0, 8)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                              style={{
                                background: d.material ? "#FBE4E2" : "#EEF1F8",
                                color: d.material ? "#C0392B" : "#6B7494",
                              }}
                            >
                              {d.tipo === "drift" ? "Saldo≠libro" : "Sobre-cobro"}
                              {d.material ? " · material" : " · redondeo"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gris">{d.estado}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-tinta">{UYU(d.pagadoAcum)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-tinta">{UYU(d.pagosSuma)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gris">{UYU(d.totalAPagar)}</td>
                          <td
                            className="px-3 py-2.5 text-right font-bold tabular-nums"
                            style={{ color: d.material ? "#C0392B" : "#9A6A0E" }}
                          >
                            {dif > 0 ? "+" : ""}
                            {UYU(dif)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-0.5 text-[11.5px] leading-[1.5] font-medium text-gris">
                <b>Saldo≠libro</b>: el saldo denormalizado de la app no coincide con la suma real de pagos
                (siempre a revisar). <b>Sobre-cobro</b>: el crédito registra más pagos que su total — los
                <b> materiales</b> (≥1 cuota o ≥5% del total) merecen mirada; los de <b>redondeo</b> son ruido
                pre-existente del empalme original (casi todos de créditos ya finalizados). Corrida manual y
                exhaustiva: <code>node --env-file=.env.local scripts/reconciliacion.mjs</code>.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valor, tono }: { label: string; valor: string; tono: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#E6EAF4] bg-white px-3.5 py-3">
      <span className="text-[11px] font-bold tracking-wide text-gris uppercase">{label}</span>
      <span className="text-[20px] font-black tabular-nums" style={{ color: tono }}>
        {valor}
      </span>
    </div>
  );
}

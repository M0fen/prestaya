// ─────────────────────────────────────────────────────────────────────────
//  ESTADO DE LA OPERACIÓN (admin / supervisor) — lo invisible, a la vista.
//
//  Las cuatro cosas que el sistema NO mostraba en ninguna pantalla:
//   1. quién no está cobrando, ordenado por la plata que tiene sin mirar;
//   2. cómo está repartida la carga (mediana 59 clientes, máximo 125);
//   3. los clientes que no están en la ruta de nadie;
//   4. la cartera de un cobrador dado de baja.
//
//  ⚠️ SOLO LECTURA. Desde acá no se mueve un cliente ni se toca plata. Reasignar
//  es otra decisión y todavía no está habilitada.
//  Desktop-first: el supervisor mira esto sentado, no en la calle.
// ─────────────────────────────────────────────────────────────────────────
import { requireGestor } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase/server";
import { alcanceDelActor } from "@/lib/data/alcance";
import {
  getCarteraDeBaja,
  getClientesSinRuta,
  getCobradoresEnSilencio,
} from "@/lib/data/operacion";
import { UYU } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OperacionPage() {
  await requireGestor();
  const db = await createSupabaseServer();
  const alcance = await alcanceDelActor();

  const [silencio, sinRuta, deBaja] = await Promise.all([
    getCobradoresEnSilencio(db, alcance),
    getClientesSinRuta(),
    getCarteraDeBaja(alcance),
  ]);

  const activos = silencio.filter((c) => c.diasSinCobrar !== null);
  const nunca = silencio.filter((c) => c.diasSinCobrar === null);
  const cargas = silencio.map((c) => c.clientes).filter((n) => n > 0).sort((a, b) => a - b);
  const mediana = cargas.length ? cargas[Math.floor(cargas.length / 2)] : 0;
  const maximo = cargas.length ? cargas[cargas.length - 1] : 0;

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-black text-tinta">Estado de la operación</h1>
        <p className="text-[13px] font-medium text-gris">
          Lo que no aparece en ninguna otra pantalla. Solo para mirar: desde acá no se mueve nada.
        </p>
      </header>

      {/* ── 1 · QUIÉN NO ESTÁ COBRANDO ─────────────────────────────────────
          No es una alarma con umbral y hay un motivo medido: a 7 días dispararía
          sobre 46 de 47 cobradores. Se ordena por plata en riesgo, que es la
          pregunta que de verdad se hace el supervisor. */}
      <section className="flex flex-col gap-3 rounded-[16px] border border-campo bg-tarjeta p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-extrabold text-tinta">Quién no está cobrando</h2>
          <span className="text-[12px] font-medium text-gris">
            ordenado por la plata que tiene sin mirar
          </span>
        </div>

        {activos.length === 0 ? (
          <p className="text-[13px] font-medium text-gris">
            Todos los cobradores con cartera registraron cobros hace poco.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-campo text-left text-[11.5px] font-bold text-gris">
                  <th className="py-2">Cobrador</th>
                  <th className="py-2">Zona</th>
                  <th className="py-2 text-right">Clientes</th>
                  <th className="py-2 text-right">Por cobrar</th>
                  <th className="py-2 text-right">Sin cobrar hace</th>
                </tr>
              </thead>
              <tbody>
                {activos.map((c) => (
                  <tr key={c.cobradorId} className="border-b border-campo/50">
                    <td className="py-2 font-bold text-tinta">{c.nombre}</td>
                    <td className="py-2 text-gris">{c.zonaNombre ?? "— sin zona"}</td>
                    <td className="py-2 text-right tabular-nums">{c.clientes}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-tinta">
                      {UYU(c.capitalVivo)}
                    </td>
                    <td
                      className={`py-2 text-right font-extrabold tabular-nums ${
                        (c.diasSinCobrar ?? 0) >= 14 ? "text-rojo-osc" : "text-ambar-osc"
                      }`}
                    >
                      {c.diasSinCobrar} {c.diasSinCobrar === 1 ? "día" : "días"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nunca.length > 0 && (
          <div className="rounded-[12px] bg-campo px-3.5 py-3">
            <p className="text-[13px] font-bold text-tinta">
              {nunca.length} cobrador{nunca.length === 1 ? "" : "es"} con clientes asignados que
              nunca registró un cobro por la app
            </p>
            <p className="mt-1 text-[12px] font-medium text-gris">
              Tienen {UYU(nunca.reduce((s, c) => s + c.capitalVivo, 0))} por cobrar entre todos.
              Esto es adopción, no abandono: no se resuelve con una llamada.
            </p>
            <p className="mt-2 text-[12px] leading-[1.5] text-gris">
              {nunca.map((c) => c.nombre).join(" · ")}
            </p>
          </div>
        )}
      </section>

      {/* ── 2 · CARGA ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-[16px] border border-campo bg-tarjeta p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-extrabold text-tinta">Cómo está repartida la carga</h2>
          <span className="text-[12px] font-medium text-gris">
            mediana {mediana} clientes · máximo {maximo}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {[...silencio]
            .sort((a, b) => b.clientes - a.clientes)
            .map((c) => (
              <div key={c.cobradorId} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 truncate text-[12.5px] font-bold text-tinta">
                  {c.nombre}
                </span>
                <div className="h-[18px] flex-1 overflow-hidden rounded-[6px] bg-campo">
                  <div
                    className={`h-full ${c.clientes > mediana * 1.5 ? "bg-ambar" : "bg-azul"}`}
                    style={{ width: `${maximo ? Math.round((c.clientes / maximo) * 100) : 0}%` }}
                  />
                </div>
                <span className="w-[46px] shrink-0 text-right text-[12.5px] font-extrabold tabular-nums text-tinta">
                  {c.clientes}
                </span>
                <span className="w-[110px] shrink-0 text-right text-[12px] tabular-nums text-gris">
                  {UYU(c.capitalVivo)}
                </span>
              </div>
            ))}
        </div>
        <p className="text-[11.5px] font-medium text-gris">
          En ámbar, los que llevan más de una vez y media la mediana.
        </p>
      </section>

      {/* ── 3 · SIN RUTA ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3 rounded-[16px] border border-campo bg-tarjeta p-4">
        <h2 className="text-[16px] font-extrabold text-tinta">Clientes que no están en ninguna ruta</h2>

        {sinRuta.conPlataViva.length > 0 ? (
          <div className="rounded-[12px] bg-rojo-suave px-3.5 py-3">
            <p className="text-[13px] font-extrabold text-rojo-osc">
              ⚠️ {sinRuta.conPlataViva.length} con crédito ACTIVO —{" "}
              {UYU(sinRuta.conPlataViva.reduce((s, c) => s + c.capitalVivo, 0))} que ningún cobrador ve
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {sinRuta.conPlataViva.slice(0, 20).map((c) => (
                <li key={c.clienteId} className="text-[12.5px] font-medium text-rojo-osc">
                  <Link href={`/admin/clientes/${c.clienteId}`} className="underline">
                    {c.nombre}
                  </Link>{" "}
                  · {c.creditosActivos} crédito{c.creditosActivos === 1 ? "" : "s"} ·{" "}
                  {UYU(c.capitalVivo)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-[12px] bg-verde-suave px-3.5 py-2.5 text-[13px] font-bold text-verde-osc">
            ✅ Ninguno con crédito activo: no hay plata en la calle fuera de una ruta.
          </p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] font-medium text-gris">
          <span>
            <b className="text-tinta">{sinRuta.total}</b> clientes sin cobrador en total
          </span>
          <span>
            <b className="text-tinta">{sinRuta.exClientes.length}</b> tuvieron crédito alguna vez
          </span>
          <span>
            <b className="text-tinta">{sinRuta.soloPadron}</b> nunca tuvieron crédito (padrón del import)
          </span>
        </div>

        {sinRuta.exClientes.length > 0 && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer font-bold text-azul">
              Ver los que tuvieron crédito y hoy no están en ninguna ruta
            </summary>
            <ul className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
              {sinRuta.exClientes.map((c) => (
                <li key={c.clienteId} className="truncate text-gris">
                  <Link href={`/admin/clientes/${c.clienteId}`} className="text-tinta hover:underline">
                    {c.nombre}
                  </Link>
                  {c.documento ? ` · ${c.documento}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── 4 · CARTERA DE UN COBRADOR DADO DE BAJA ───────────────────────── */}
      <section className="flex flex-col gap-3 rounded-[16px] border border-campo bg-tarjeta p-4">
        <h2 className="text-[16px] font-extrabold text-tinta">Cartera de cobradores dados de baja</h2>
        {deBaja.length === 0 ? (
          <p className="text-[13px] font-medium text-gris">
            Ninguna. Cuando se da de baja a un cobrador, sus clientes NO pasan solos a nadie: quedan
            en su ruta y desaparecen del tablero de cobranza. Acá van a aparecer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-campo text-left text-[11.5px] font-bold text-gris">
                  <th className="py-2">Cobrador (de baja)</th>
                  <th className="py-2">Zona</th>
                  <th className="py-2 text-right">Clientes</th>
                  <th className="py-2 text-right">Créditos activos</th>
                  <th className="py-2 text-right">Por cobrar</th>
                </tr>
              </thead>
              <tbody>
                {deBaja.map((c) => (
                  <tr key={c.cobradorId} className="border-b border-campo/50">
                    <td className="py-2 font-bold text-tinta">{c.nombre}</td>
                    <td className="py-2 text-gris">{c.zonaNombre ?? "— sin zona"}</td>
                    <td className="py-2 text-right tabular-nums">{c.clientes}</td>
                    <td className="py-2 text-right tabular-nums">{c.creditosActivos}</td>
                    <td className="py-2 text-right font-extrabold tabular-nums text-rojo-osc">
                      {UYU(c.capitalVivo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

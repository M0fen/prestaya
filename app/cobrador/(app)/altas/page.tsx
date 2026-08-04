// ─────────────────────────────────────────────────────────────────────────
//  ALTAS — "a quién le falta su cartón".
//  Los clientes todavía no tienen el link: esto convierte la entrega en una
//  lista de trabajo con avance visible, en vez de "creo que ya se lo di".
//  El orden es el del trabajo: primero los que faltan.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getAltasDeMiRuta, type ClienteAlta } from "@/lib/data/acceso";
import { conTimeout } from "@/lib/timeout";
import { fechaHoraUY } from "@/lib/format";

export const dynamic = "force-dynamic";

const TOPE_MS = 22_000;

export default async function AltasPage() {
  const db = await createSupabaseServer();
  const clientes = await conTimeout(getAltasDeMiRuta(db), TOPE_MS, "cobrador.altas");

  const pendientes = clientes.filter((c) => c.estado === "pendiente");
  const entregados = clientes.filter((c) => c.estado === "entregado");
  const activos = clientes.filter((c) => c.estado === "activo");
  // Los que no pueden usar la app salen del denominador (0131): si contaran,
  // el avance nunca llegaría al 100% aunque el cobrador hiciera todo su trabajo.
  const noAplica = clientes.filter((c) => c.estado === "no_aplica");
  const total = clientes.length - noAplica.length;
  const pct = total > 0 ? Math.round((activos.length / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Ruta
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-[21px] font-extrabold text-tinta">Dar de alta en la app</h1>
        <p className="text-[13px] font-medium text-gris">
          Cada cliente tiene su propio código. Mostráselo y su cartón le queda en el teléfono.
        </p>
      </div>

      {/* Avance de la campaña: lo que ya está hecho, no lo que falta. */}
      <div className="flex flex-col gap-2 rounded-[16px] bg-[linear-gradient(150deg,#2453DC_0%,#1E47C8_45%,#13308C_100%)] p-4 shadow-[0_10px_24px_rgba(19,48,140,0.28)]">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-bold text-white/80">Ya usan la app</span>
          <span className="text-[22px] font-black text-white tabular-nums">
            {activos.length}
            <span className="text-[14px] font-bold text-white/60">/{total}</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#34E0A1,#1FA971)] transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11.5px] font-semibold text-white/70">
          {total === 0
            ? "Todavía no tenés clientes asignados."
            : pendientes.length > 0
              ? `Te faltan ${pendientes.length} por entregar`
              : entregados.length > 0
                ? `Entregaste todos · ${entregados.length} sin abrir todavía`
                : "¡Todos tus clientes tienen su cartón! 🎉"}
          {noAplica.length > 0 && ` · ${noAplica.length} no usa${noAplica.length === 1 ? "" : "n"} la app`}
        </span>
      </div>

      <Grupo
        titulo="Faltan por entregar"
        clientes={pendientes}
        vacio="No queda ninguno pendiente 🎉"
        destacado
      />
      <Grupo
        titulo="Entregados · falta que lo abran"
        clientes={entregados}
        vacio={null}
        pie={(c) => `Se lo entregaste el ${fechaHoraUY(c.entregadoEn)}`}
      />
      <Grupo
        titulo="Ya lo usan"
        clientes={activos}
        vacio={null}
        pie={(c) => `Lo abrió el ${fechaHoraUY(c.vistoEn)}`}
      />
      {/* Fuera de la campaña, pero visibles: el cobrador tiene que poder
          encontrarlos si alguno consigue teléfono. */}
      <Grupo
        titulo="No usan la app"
        clientes={noAplica}
        vacio={null}
        pie={() => "Fuera de la campaña · les cobrás normal"}
      />
    </div>
  );
}

function Grupo({
  titulo,
  clientes,
  vacio,
  pie,
  destacado = false,
}: {
  titulo: string;
  clientes: ClienteAlta[];
  vacio: string | null;
  pie?: (c: ClienteAlta) => string;
  destacado?: boolean;
}) {
  if (clientes.length === 0) {
    if (!vacio) return null;
    return (
      <p className="rounded-[14px] bg-[#E4F5EC] px-4 py-3 text-center text-[13px] font-bold text-[#157A50]">
        {vacio}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[12px] font-extrabold tracking-wide text-gris uppercase">
        {titulo} · {clientes.length}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {clientes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/cobrador/cliente/${c.id}/acceso`}
              className={`flex items-center gap-3 rounded-[13px] px-3.5 py-3 active:scale-[0.99] ${
                destacado
                  ? "border border-[#DCE6FB] bg-white shadow-[0_1px_3px_rgba(26,34,71,0.05)]"
                  : "bg-white/60"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-bold text-tinta">{c.nombre}</span>
                <span className="truncate text-[11.5px] font-medium text-gris tabular-nums">
                  {pie ? pie(c) : c.telefono ? c.telefono : "Sin teléfono"}
                </span>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold ${
                  destacado ? "bg-[#1E47C8] text-white" : "text-azul"
                }`}
              >
                {destacado ? "Dar de alta" : "Ver QR"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

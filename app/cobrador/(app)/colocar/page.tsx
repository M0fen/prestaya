// ─────────────────────────────────────────────────────────────────────────
//  COLOCAR CAPITAL DESDE LA CALLE — dos modos en la misma pantalla:
//    ?modo=renovar → clientes que terminaron de pagar (repetir, 1 toque)
//    ?modo=venta   → clientes sin crédito activo (monto a elección)
//  Los candidatos salen del servidor con las MISMAS reglas que después
//  validan el alta, así la lista nunca ofrece algo que va a ser rechazado.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { getCandidatosRenovar, getCandidatosVenta } from "@/lib/data/colocar";
import { ColocarLista } from "@/components/cobrador/ColocarLista";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export default async function ColocarPage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string }>;
}) {
  const { modo: raw } = await searchParams;
  const modo: "renovar" | "venta" = raw === "venta" ? "venta" : "renovar";

  const db = await createSupabaseServer();
  // El id acota "Renovar" a los créditos PROPIOS: en un cliente compartido, el
  // saldado del compañero no se puede renovar (el servidor lo rechaza) y ofrecerlo
  // dejaba al cobrador con la letra roja delante del cliente.
  const usuario = await getUsuarioActual();
  const candidatos = await conTimeout(
    modo === "renovar"
      ? getCandidatosRenovar(db, usuario?.rol === "cobrador" ? usuario.id : null)
      : getCandidatosVenta(db),
    TOPE_MS,
    `cobrador.colocar.${modo}`,
  );

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Mi ruta
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-[21px] font-extrabold text-tinta">
          {modo === "renovar" ? "Renovar" : "Nueva venta"}
        </h1>
        <p className="text-[13px] leading-[1.5] font-medium text-gris">
          {modo === "renovar"
            ? "Tus clientes que ya terminaron de pagar. Se repite el mismo crédito: mismo monto, misma cuota."
            : "Tus clientes sin crédito activo. Elegís el monto, dentro de lo que le corresponde por su historial."}
        </p>
      </div>

      {/* Cambiar de modo sin volver atrás. */}
      <div className="flex gap-2">
        {(
          [
            { id: "renovar", label: "🔁 Renovar" },
            { id: "venta", label: "💵 Nueva venta" },
          ] as const
        ).map((m) => (
          <Link
            key={m.id}
            href={`/cobrador/colocar?modo=${m.id}`}
            className={`min-h-11 flex-1 rounded-full px-3 text-center text-[13px] font-bold leading-[44px] ${
              modo === m.id ? "bg-[#1E47C8] text-white" : "bg-[#EEF3FF] text-azul"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      <ColocarLista modo={modo} candidatos={candidatos} />

      <p className="rounded-[13px] border border-[#F0E3C8] bg-[#FDF8EC] px-3.5 py-3 text-[11.5px] leading-[1.5] font-medium text-[#7A5B10]">
        El crédito queda creado al instante y con tu nombre. Si necesitás dar más de lo que
        permite el historial del cliente, pedíselo a tu supervisor.
      </p>
    </div>
  );
}

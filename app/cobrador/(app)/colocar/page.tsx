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
import { getCandidatosRenovar, getCandidatosVenta, getNoElegibles } from "@/lib/data/colocar";
import { ColocarLista } from "@/components/cobrador/ColocarLista";
import { conTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
const TOPE_MS = 22_000;

export default async function ColocarPage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string; cliente?: string }>;
}) {
  const { modo: raw, cliente: clienteFoco } = await searchParams;
  const modo: "renovar" | "venta" = raw === "venta" ? "venta" : "renovar";

  const db = await createSupabaseServer();
  // El id acota "Renovar" a los créditos PROPIOS: en un cliente compartido, el
  // saldado del compañero no se puede renovar (el servidor lo rechaza) y ofrecerlo
  // dejaba al cobrador con la letra roja delante del cliente.
  const usuario = await getUsuarioActual();
  const cobradorId = usuario?.rol === "cobrador" ? usuario.id : null;
  // Además de los candidatos, los que HOY no se pueden — con el motivo. Un cliente
  // que no entra en ninguna de las dos listas antes desaparecía sin explicación y
  // el cobrador se quedaba parado frente a él creyendo que la app estaba rota.
  //  RENOVAR  → solo los que TERMINARON de pagar. Se repite tal cual, un toque.
  //  NUEVA VENTA → el MISMO momento pero eligiendo monto y cuotas, así que incluye
  //  a los dos grupos: los que terminaron (se cierra el anterior y nace el nuevo con
  //  los términos que elija) y los que quedaron sin crédito activo. Antes "venta"
  //  excluía a los que acababan de terminar, y el que quería darle otro monto a un
  //  cliente recién saldado no lo encontraba en ninguna de las dos listas.
  const [saldados, libres, noElegibles] = await conTimeout(
    Promise.all([
      getCandidatosRenovar(db, cobradorId),
      modo === "venta" ? getCandidatosVenta(db) : Promise.resolve([]),
      getNoElegibles(db, cobradorId, modo),
    ]),
    TOPE_MS,
    `cobrador.colocar.${modo}`,
  );
  const candidatos =
    modo === "renovar"
      ? saldados
      : [...saldados, ...libres].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

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
            ? "Repite el crédito tal cual lo tenía: mismo monto, misma cuota, mismas cuotas. Un toque y listo."
            : "El mismo cliente, pero elegís vos el monto y las cuotas."}
          {" "}
          <strong className="font-bold">
            Si no encontrás a alguien, buscalo igual: te dice por qué no aparece.
          </strong>
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

      <ColocarLista
        modo={modo}
        candidatos={candidatos}
        noElegibles={noElegibles}
        clienteFoco={clienteFoco ?? null}
      />

      <p className="rounded-[13px] border border-[#F0E3C8] bg-[#FDF8EC] px-3.5 py-3 text-[11.5px] leading-[1.5] font-medium text-[#7A5B10]">
        El crédito queda creado al instante y con tu nombre. Si necesitás dar más de lo que
        permite el historial del cliente, pedíselo a tu supervisor.
      </p>
    </div>
  );
}

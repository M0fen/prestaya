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
  // ⚠️ SIN DEDUPLICAR, el que TERMINÓ de pagar aparecía DOS VECES en "Nueva venta":
  // una desde `saldados` ("Terminó de pagar ✓") y otra desde `libres` ("Sin crédito
  // activo"), porque la lista de venta ya no excluye a los que tienen crédito
  // activo. Son 142 clientes reales hoy — Yuli Toro vería 16 nombres repetidos.
  // Y no es solo feo: la tarjeta de `libres` toma el camino de ALTA, que NO cierra
  // el crédito terminado; el cliente quedaba con el viejo saldado activo para
  // siempre y el sistema lo seguía ofreciendo en "Renovar". Gana la de `saldados`,
  // que va por la renovación y cierra el anterior en la misma operación atómica.
  const conSaldado = new Set(saldados.map((c) => c.clienteId));

  // ⚠️ EL QUE SE PUEDE COLOCAR NO PUEDE ESTAR TAMBIÉN EN LOS BLOQUEADOS.
  //
  // Hasta el 07-08 los dos conjuntos eran disjuntos por construcción: renovar
  // exigía TODOS los créditos del cliente en cero. Cuando `e6ae477` cambió la regla
  // a "saldado solo el crédito que se renueva" (bien, es la regla del negocio),
  // `getNoElegibles` quedó con el criterio viejo — mira la deuda del CLIENTE, no del
  // crédito. Resultado: el cobrador busca un nombre y le salen DOS tarjetas del
  // mismo cliente, una arriba de la otra: la verde "Terminó de pagar ✓ · Renovar" y
  // la ámbar "Todavía está pagando: le falta $34.800. Se RENUEVA cuando termine".
  // Una dice colocá, la otra dice esperá. Medido: ~90 pares cliente-cobrador hoy.
  const candidatos =
    modo === "renovar"
      ? saldados
      : [...saldados, ...libres.filter((c) => !conSaldado.has(c.clienteId))].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, "es"),
        );
  const ofrecidos = new Set(candidatos.map((c) => c.clienteId));
  const bloqueados = noElegibles.filter((n) => !ofrecidos.has(n.clienteId));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/cobrador" className="text-[13px] font-semibold text-gris">
        ← Mi ruta
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-[19px] font-extrabold text-tinta">
          {modo === "renovar" ? "Renovar" : "Nueva venta"}
        </h1>
        <p className="text-[13px] leading-[1.5] font-medium text-gris">
          {modo === "renovar"
            ? "Repite el crédito tal cual lo tenía: un toque y listo. ¿Quiere más monto, otras cuotas o pasar a semanal? Tocá Renovar y abrí «Cambiar monto, cuotas o formato»."
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
              modo === m.id ? "bg-[#1E47C8] text-white" : "bg-azul-suave text-azul"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      <ColocarLista
        modo={modo}
        candidatos={candidatos}
        noElegibles={bloqueados}
        clienteFoco={clienteFoco ?? null}
      />

      <p className="rounded-[12px] border border-ambar-suave bg-ambar-suave px-3.5 py-3 text-[11.5px] leading-[1.5] font-medium text-ambar-osc">
        El crédito queda creado al instante y con tu nombre. Si ponés más de lo que permite el
        historial del cliente, el mismo botón le manda el pedido a tu supervisor — no entregues
        la plata hasta que lo aprueben.
      </p>
    </div>
  );
}

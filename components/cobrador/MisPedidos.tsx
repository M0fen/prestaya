// ─────────────────────────────────────────────────────────────────────────
//  "TUS PEDIDOS" — el aviso que le faltaba al que pide.
//
//  Tres reglas, sacadas de lo que salió mal en la calle:
//   1. Se dice el ESTADO con el color correcto. Verde = hacé algo con la plata.
//      Ámbar = esperá, NO entregues. Gris = ya está, es constancia.
//   2. Se dice HACE CUÁNTO. Un pedido de hace dos días no es lo mismo que uno de
//      hace diez minutos, y hasta ahora los dos se veían igual: invisibles.
//   3. Se dice QUÉ HACER MIENTRAS TANTO. Un aviso sin salida es lo que empuja al
//      cobrador a volver a colocar el crédito — que es exactamente cómo nació el
//      crédito duplicado de JORGE.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { UYU } from "@/lib/format";
import type { Pedido } from "@/lib/data/misPedidos";

const TONO = {
  aprobado: { borde: "#BEEBD5", fondo: "#F0FBF5", texto: "#157A50", chip: "Aprobado ✓" },
  pendiente: { borde: "#F0DCA8", fondo: "#FDF8EC", texto: "#8A6D1E", chip: "Esperando" },
  rechazado: { borde: "#E4E8F4", fondo: "#FFFFFF", texto: "#6B7494", chip: "No se aprobó" },
} as const;

const ICONO = { renovacion: "🔁", gasto: "🧾", correccion: "✏️", aviso: "📣" } as const;

/** "hace 20 min" · "hace 3 h" · "hace 2 días". Vago a propósito arriba de un día:
 *  lo que importa es la sensación de que se está haciendo viejo. */
function hace(horas: number): string {
  if (horas < 1) return `hace ${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 24) return `hace ${Math.round(horas)} h`;
  const d = Math.round(horas / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

export function MisPedidos({ pedidos }: { pedidos: Pedido[] }) {
  if (pedidos.length === 0) return null;

  const esperando = pedidos.filter((p) => p.estado === "pendiente").length;
  const listos = pedidos.filter((p) => p.estado === "aprobado").length;

  return (
    <section className="flex flex-col gap-2 rounded-[16px] border border-[#DCE6FB] bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-extrabold text-tinta">📬 Tus pedidos</span>
        <span className="text-[11.5px] font-semibold text-gris tabular-nums">
          {listos > 0 && `${listos} listo${listos === 1 ? "" : "s"}`}
          {listos > 0 && esperando > 0 && " · "}
          {esperando > 0 && `${esperando} esperando`}
        </span>
      </div>

      {pedidos.map((p) => {
        const t = TONO[p.estado];
        const cuerpo = (
          <>
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="text-[13px]">
                  {ICONO[p.tipo]}
                </span>
                <span className="truncate text-[13px] font-extrabold text-tinta">{p.titulo}</span>
              </span>
              {/* Un aviso no tiene monto: mostrar "$0" al lado de un pedido de
                  ayuda lo hace parecer un error de la app. */}
              {p.monto > 0 && (
                <span
                  className="flex-shrink-0 text-[13.5px] font-black tabular-nums"
                  style={{ color: t.texto }}
                >
                  {UYU(p.monto)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: t.fondo === "#FFFFFF" ? "#EEF1F8" : "#FFFFFF", color: t.texto }}
              >
                {t.chip}
              </span>
              {/* La ANTIGÜEDAD, que era el dato que no estaba en ningún lado. */}
              <span className="text-[10.5px] font-semibold text-gris tabular-nums">
                pedido {hace(p.horasEsperando)}
              </span>
            </div>
            <span className="text-[11.5px] leading-[1.45] font-medium" style={{ color: t.texto }}>
              {p.queHacer}
            </span>
            {p.motivo && (
              <span className="rounded-[9px] bg-[#F4F6FB] px-2.5 py-1.5 text-[11.5px] leading-[1.4] font-semibold text-[#3A445F]">
                📝 {p.motivo}
              </span>
            )}
          </>
        );

        const clase = "flex flex-col gap-1.5 rounded-[12px] border p-3";
        const estilo = { borderColor: t.borde, background: t.fondo };
        return p.href ? (
          <Link key={p.id} href={p.href} className={`${clase} active:scale-[0.99]`} style={estilo}>
            {cuerpo}
          </Link>
        ) : (
          <div key={p.id} className={clase} style={estilo}>
            {cuerpo}
          </div>
        );
      })}
    </section>
  );
}

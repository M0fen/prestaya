"use client";
// ─────────────────────────────────────────────────────────────────────────
//  COLA DE DESPACHO A CURBE (0112). Cada venta de un producto que despacha Curbe
//  aparece acá. El admin le avisa a Curbe por WhatsApp (mensaje pre-armado con
//  producto + cliente + dirección) y avanza el estado: pendiente → pedido →
//  despachado. Es logística (no dinero: el crédito ya vive en el cliente).
// ─────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarPedidoCurbe } from "@/lib/acciones/pedidosCurbe";
import { linkWhatsApp } from "@/lib/telefono";
import { CURBE_WHATSAPP, mensajePedidoCurbe } from "@/lib/curbe";
import type { PedidoCurbe, EstadoPedidoCurbe } from "@/lib/data/pedidosCurbe";

const ETIQUETA: Record<EstadoPedidoCurbe, { label: string; bg: string; fg: string }> = {
  pendiente: { label: "Avisar a Curbe", bg: "var(--color-ambar-suave)", fg: "var(--color-ambar-osc)" },
  pedido: { label: "Pedido a Curbe", bg: "var(--color-azul-suave)", fg: "var(--color-azul)" },
  despachado: { label: "Despachado ✓", bg: "var(--color-verde-suave)", fg: "var(--color-verde-osc)" },
  cancelado: { label: "Cancelado", bg: "var(--color-suave)", fg: "var(--color-gris)" },
};

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function PedidosCurbe({ pedidos }: { pedidos: PedidoCurbe[] }) {
  const [verTodos, setVerTodos] = useState(false);
  // Por defecto: los que reclaman acción (pendiente / pedido a Curbe pero no despachado).
  const visibles = verTodos ? pedidos : pedidos.filter((p) => p.estado === "pendiente" || p.estado === "pedido");
  const pendientes = pedidos.filter((p) => p.estado === "pendiente").length;

  if (pedidos.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5 rounded-[16px] border border-borde bg-tarjeta p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-extrabold text-tinta">📦 Pedidos a Curbe (despacho)</span>
          <span className="text-[11.5px] font-medium text-gris">
            Ventas de productos que despacha Curbe. Avisales por WhatsApp y seguí el pedido hasta que lo entreguen.
          </span>
        </div>
        {pendientes > 0 && (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#E8A317] px-2 text-[11px] font-black text-[#0F1B3D]">{pendientes}</span>
        )}
      </div>
      {!CURBE_WHATSAPP && (
        <p className="rounded-[12px] border border-linea bg-suave px-3 py-2 text-[11.5px] font-medium text-gris">
          💡 Cargá <code className="font-bold">NEXT_PUBLIC_CURBE_WHATSAPP</code> (el número de Curbe) para avisar con un toque.
          Por ahora podés copiar el pedido y enviarlo a mano.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {visibles.map((p) => (
          <Fila key={p.id} p={p} />
        ))}
      </ul>
      {pedidos.length > visibles.length && !verTodos && (
        <button type="button" onClick={() => setVerTodos(true)} className="self-start text-[12px] font-bold text-azul">
          Ver todos ({pedidos.length}) →
        </button>
      )}
    </section>
  );
}

function Fila({ p }: { p: PedidoCurbe }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [copiado, setCopiado] = useState(false);
  const e = ETIQUETA[p.estado];
  const cerrado = p.estado === "despachado" || p.estado === "cancelado";

  const mensaje = mensajePedidoCurbe({
    productoNombre: p.productoNombre,
    clienteNombre: p.clienteNombre,
    clienteTelefono: p.clienteTelefono,
    clienteDireccion: p.clienteDireccion,
  });

  const mover = (estado: EstadoPedidoCurbe) =>
    start(async () => {
      const r = await actualizarPedidoCurbe({ id: p.id, estado });
      if (r.ok) router.refresh();
    });

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* clipboard bloqueado: sin drama */
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-[12px] border border-linea bg-suave p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13.5px] font-bold text-tinta">{p.productoNombre}</span>
          <span className="text-[11.5px] font-medium text-gris">
            {p.clienteNombre ?? "Cliente"}{p.clienteTelefono ? ` · 📞 ${p.clienteTelefono}` : ""} · {cuando(p.creadoEn)}
          </span>
          {p.clienteDireccion && (
            <span className="truncate text-[11.5px] font-medium text-gris">📍 {p.clienteDireccion}</span>
          )}
        </div>
        <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: e.bg, color: e.fg }}>{e.label}</span>
      </div>
      {!cerrado && (
        <div className="flex flex-wrap items-center gap-1.5">
          {CURBE_WHATSAPP ? (
            <a
              href={linkWhatsApp(CURBE_WHATSAPP, mensaje)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (p.estado === "pendiente") mover("pedido"); }}
              className="rounded-full bg-[#25D366] px-3 py-1.5 text-[11.5px] font-bold text-white"
            >
              Avisar a Curbe (WhatsApp)
            </a>
          ) : (
            <button type="button" onClick={copiar} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-azul">
              {copiado ? "Copiado ✓" : "Copiar pedido"}
            </button>
          )}
          {p.estado === "pendiente" && (
            <button type="button" disabled={pend} onClick={() => mover("pedido")} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-azul disabled:opacity-60">Marcar avisado</button>
          )}
          <button type="button" disabled={pend} onClick={() => mover("despachado")} className="rounded-full border border-borde bg-tarjeta px-3 py-1.5 text-[11.5px] font-bold text-verde-osc disabled:opacity-60">Despachado ✓</button>
          <button type="button" disabled={pend} onClick={() => mover("cancelado")} className="rounded-full px-2.5 py-1.5 text-[11.5px] font-bold text-gris disabled:opacity-60">Cancelar</button>
        </div>
      )}
    </li>
  );
}

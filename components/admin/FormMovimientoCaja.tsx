"use client";
// Alta de un movimiento de caja (gestor): gasto, desembolso, aporte o retiro.
// Los cobros NO se cargan acá (se registran en la calle). Guarda por Server
// Action y refresca el resumen.
//   cuenta="operativa" (default) → gastos de ruta (pantalla "Caja diaria").
//   cuenta="capital"             → aportes/retiros del dueño (pantalla "Inversión
//                                  de capital"), solo Ingreso/Retiro.
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { agregarMovimientoCaja } from "@/lib/acciones/caja";

// Nonce de idempotencia con FALLBACK a un UUID v4 válido (mismo criterio que
// RegistrarPagoPanel): sin crypto.randomUUID el servidor descartaría un nonce mal
// formado y caería al op_id determinista POR MINUTO, que podía tragarse un 2º
// movimiento idéntico del mismo minuto (23505 → "ok" sin insertar). Con UUID
// válido, cada envío exitoso tiene su propia clave.
const nuevoNonce = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

type Tipo = { id: "egreso" | "desembolso" | "ingreso" | "retiro"; label: string; cats: string[] };

// Categorías operativas alineadas a Disapp (Arriendo, Recargas, Gasolina/Gas,
// Ahorros, Otros Gastos) + las que ya usaba el equipo.
const TIPOS_OPERATIVA: Tipo[] = [
  { id: "egreso", label: "Gasto", cats: ["Arriendo", "Recargas", "Gasolina / Gas", "Ahorros", "Sueldo", "Comida", "Mantenimiento", "Otros Gastos"] },
  { id: "desembolso", label: "Desembolso", cats: ["Crédito nuevo", "Renovación", "Otro"] },
  { id: "ingreso", label: "Aporte / Ingreso", cats: ["Capital", "Otro"] },
  { id: "retiro", label: "Retiro del dueño", cats: ["Retiro", "Otro"] },
];

// Conceptos de capital (captura 6 de Disapp).
const TIPOS_CAPITAL: Tipo[] = [
  { id: "ingreso", label: "Ingreso", cats: ["Aporte a Caja de Vendedor", "Transferencia a Caja General", "Otro"] },
  { id: "retiro", label: "Retiro", cats: ["Retiro", "Descuadre", "Transferencia a Caja General", "Otro"] },
];

export function FormMovimientoCaja({ cuenta = "operativa" }: { cuenta?: "operativa" | "capital" }) {
  const router = useRouter();
  const TIPOS = cuenta === "capital" ? TIPOS_CAPITAL : TIPOS_OPERATIVA;
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<Tipo["id"]>(TIPOS[0].id);
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState(TIPOS[0].cats[0]);
  const [descripcion, setDescripcion] = useState("");
  const [visible, setVisible] = useState(true);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Nonce de idempotencia: estable mientras se reintenta el MISMO movimiento; se
  // renueva tras un alta exitosa (el próximo movimiento tiene clave nueva).
  const nonceRef = useRef<string | null>(null);

  const cats = TIPOS.find((t) => t.id === tipo)!.cats;
  const montoNum = Math.round(Number(monto));
  const valido = Number.isFinite(montoNum) && montoNum > 0;

  const guardar = () => {
    if (!valido || pendiente) return;
    setError(null);
    if (!nonceRef.current) nonceRef.current = nuevoNonce();
    startTransition(async () => {
      const res = await agregarMovimientoCaja({ tipo, monto: montoNum, categoria, descripcion, cuenta, visible, idempotencyKey: nonceRef.current });
      if (res.ok) {
        nonceRef.current = null; // próximo movimiento = clave nueva
        setMonto("");
        setDescripcion("");
        setAbierto(false);
        router.refresh();
      } else setError(res.error);
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-full bg-[#2453DC] px-4 py-2.5 text-[13px] font-bold text-white active:scale-[0.99]"
      >
        + {cuenta === "capital" ? "Registrar movimiento de capital" : "Registrar movimiento"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-borde bg-tarjeta p-4">
      <span className="text-[13px] font-bold text-tinta">
        {cuenta === "capital" ? "Nuevo movimiento de capital" : "Nuevo movimiento de caja"}
      </span>

      <div className="flex flex-wrap gap-1.5">
        {TIPOS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTipo(t.id);
              setCategoria(t.cats[0]);
            }}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${
              tipo === t.id ? "bg-[#2453DC] text-white" : "bg-[#EEF3FF] text-azul"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {cuenta === "operativa" && (
        <p className="text-[11px] leading-[1.5] font-medium text-[#B9770E]">
          ⚠️ Esta es la caja <b>OPERATIVA</b> (gastos/movimientos de la ruta). Los <b>aportes y retiros de CAPITAL
          del dueño</b> se registran en <b>Inversión de capital</b> (otra cuenta) — cargarlos acá descuadra las dos.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">Monto (UYU)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="rounded-[10px] border border-borde px-3 py-2 text-[16px] font-semibold outline-none focus:border-azul"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gris">
            {cuenta === "capital" ? "Concepto" : "Categoría"}
          </span>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-[10px] border border-borde bg-tarjeta px-3 py-2 text-[16px] outline-none focus:border-azul"
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-gris">Descripción (opcional)</span>
        <input
          type="text"
          value={descripcion}
          maxLength={200}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej: nafta de la moto, adelanto a Diego…"
          className="rounded-[10px] border border-borde px-3 py-2 text-[16px] outline-none focus:border-azul"
        />
      </label>

      {cuenta === "operativa" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          <span className="text-[12px] font-semibold text-cuerpo">
            Visible en la app del cobrador
          </span>
        </label>
      )}

      {error && <span className="text-[11.5px] font-semibold text-[#C0392B]">{error}</span>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          disabled={pendiente}
          className="rounded-full border border-borde bg-tarjeta px-4 py-2.5 text-[13px] font-bold text-gris"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={!valido || pendiente}
          className="flex-1 rounded-full bg-[#1FA971] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : "Guardar movimiento"}
        </button>
      </div>
    </div>
  );
}

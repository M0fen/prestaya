"use client";
// ─────────────────────────────────────────────────────────────────────────
//  COBRAR DESDE LA LISTA, SIN ABRIR LA FICHA.
//
//  EL PROBLEMA, medido. La app se está usando de noche, en la casa, copiando el
//  cartón de papel: el domingo —día en que no se cobra— se anotaron 288 cobros,
//  277 desde el mismo punto GPS, sobre clientes que viven a 200 km. No es fraude:
//  es que registrar un cobro cuesta abrir la ficha entera, y una ruta de 117
//  clientes son más de dos horas de tipeo. La app es una SEGUNDA CARGA encima de
//  Disapp, y por eso el 06-08 cargaron 6 de 18 cobradores.
//
//  Esto convierte esas dos horas en veinte minutos: la cuota completa, que es el
//  90% de los cobros, se registra desde la lista con dos toques.
//
//  ⚠️ DÓNDE **NO** APARECE, Y POR QUÉ. Un toque solo puede existir cuando no hay
//  NADA que decidir. Se oculta si:
//   · el cliente tiene MÁS DE UN crédito propio (477 clientes): hay que elegir a
//     cuál se imputa, y adivinarlo es plata mal puesta en el cartón de alguien;
//   · ya cobró, abonó o marcó no-pago hoy — la parada está resuelta;
//   · hoy no le vence cuota, o es cartera vencida (ahí el monto no es "la cuota");
//   · la cuota es 0.
//  En todos esos casos el cobrador entra a la ficha, como siempre. La ficha NO se
//  reemplaza: se saltea cuando no aporta nada.
//
//  Usa EXACTAMENTE el mismo camino que la ficha —misma cola offline, mismo hold,
//  mismo GPS asíncrono, mismo candado del servidor—: no hay una segunda forma de
//  cobrar, hay un atajo a la misma.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { configurarUsuario, encolar, parchearGps, quitar } from "@/lib/cobrador/colaOffline";
import { UYU } from "@/lib/format";

/** Ventana en la que el cobro queda retenido antes de sincronizar: habilita
 *  "Deshacer" ante un mis-tap y le da margen al GPS asíncrono. El MISMO valor que
 *  usa la ficha — si fueran distintos, el mismo cobro se comportaría de dos
 *  maneras según desde dónde se registró. */
const HOLD_MS = 9_000;

function pedirGps(): Promise<{ lat: number | null; lng: number | null; precision: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve({ lat: null, lng: null, precision: null });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
        }),
      () => resolve({ lat: null, lng: null, precision: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 8000 },
    );
  });
}

export function CobroRapido({
  clienteId,
  clienteNombre,
  prestamoId,
  cobradorId,
  cuota,
}: {
  clienteId: string;
  clienteNombre: string;
  prestamoId: string;
  cobradorId: string;
  cuota: number;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [cobrado, setCobrado] = useState<{ opId: string; hasta: number } | null>(null);
  const armado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bloqueado = useRef(false);

  // La confirmación se DESARMA sola a los 6 s. Armada para siempre, un toque
  // distraído minutos después cobraba sin que nadie lo confirmara — es el mismo
  // criterio que ya usan el censo sin foto y el cobro de la ficha.
  useEffect(() => {
    if (!confirmar) return;
    const t = setTimeout(() => setConfirmar(false), 6_000);
    return () => clearTimeout(t);
  }, [confirmar]);

  useEffect(() => () => { if (armado.current) clearTimeout(armado.current); }, []);

  const cobrar = () => {
    // Turno: dos toques muy rápidos sobre el mismo botón encolarían DOS cobros con
    // op_id distintos, y la idempotencia por op_id no los frena (son operaciones
    // distintas). Es el mismo candado de la ficha.
    if (bloqueado.current) return;
    bloqueado.current = true;
    setConfirmar(false);
    configurarUsuario(cobradorId);
    const op = encolar(
      {
        tipo: "pago",
        clienteId,
        prestamoId,
        clienteNombre,
        // null = CUOTA COMPLETA. El monto lo resuelve el SERVIDOR (cuota o saldo,
        // lo que sea menor): así un crédito al que le quedan $200 no recibe una
        // cuota de $750, y el dinero nunca se calcula en el teléfono.
        monto: null,
        motivo: null,
        adelanto: false,
        gpsLat: null,
        gpsLng: null,
      },
      { holdMs: HOLD_MS },
    );
    void pedirGps().then((g) => parchearGps(op.id, g.lat, g.lng, g.precision));
    if (navigator.vibrate) navigator.vibrate(18);
    setCobrado({ opId: op.id, hasta: Date.now() + HOLD_MS });
    // Al vencer el hold el cobro ya salió: se apaga "Deshacer" y la fila queda
    // marcada hasta que el servidor confirme y el refresco la actualice.
    armado.current = setTimeout(() => setCobrado((c) => (c ? { ...c, hasta: 0 } : c)), HOLD_MS);
  };

  const deshacer = () => {
    if (!cobrado) return;
    quitar(cobrado.opId);
    setCobrado(null);
    bloqueado.current = false;
    if (navigator.vibrate) navigator.vibrate(12);
  };

  if (cobrado) {
    const puedeDeshacer = cobrado.hasta > 0;
    return (
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <span className="rounded-full bg-[#E4F5EC] px-2.5 py-1.5 text-[11px] font-black text-[#157A50]">
          Cobrado ✓
        </span>
        {puedeDeshacer && (
          <button
            type="button"
            onClick={deshacer}
            className="min-h-11 rounded-full border border-[#D6A79E] px-2.5 text-[11px] font-bold text-[#C0392B] active:scale-95"
          >
            Deshacer
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (confirmar ? cobrar() : setConfirmar(true))}
      className={`min-h-11 flex-shrink-0 rounded-full px-3 text-[12px] font-extrabold tabular-nums active:scale-95 ${
        confirmar ? "bg-[#157A50] text-white" : "bg-[#1FA971] text-white"
      }`}
      // El monto SIEMPRE a la vista, en los dos toques: el cobrador tiene que
      // saber qué está por registrar sin abrir nada.
      aria-label={`Cobrar ${UYU(cuota)} a ${clienteNombre}`}
    >
      {confirmar ? `Sí, ${UYU(cuota)}` : `Cobrar ${UYU(cuota)}`}
    </button>
  );
}

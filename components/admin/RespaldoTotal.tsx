"use client";
// Respaldo total: baja de un click TODOS los datasets (padrón, cartera, libro
// de pagos completo, caja del mes, mora, comisiones). Dispara las descargas una
// por una con un pequeño intervalo para que el navegador no las bloquee (pide
// permiso "descargar varios archivos" una vez → Permitir).
import { useState } from "react";

const ARCHIVOS: { href: string; nombre: string }[] = [
  { href: "/api/reportes/clientes", nombre: "clientes" },
  { href: "/api/reportes/cartera", nombre: "cartera" },
  { href: "/api/reportes/pagos", nombre: "libro de pagos" },
  { href: "/api/reportes/caja?periodo=mes", nombre: "caja (mes)" },
  { href: "/api/reportes/mora", nombre: "mora" },
  { href: "/api/reportes/comisiones?periodo=mes", nombre: "comisiones (mes)" },
];

export function RespaldoTotal() {
  const [bajando, setBajando] = useState(false);

  const bajar = async () => {
    setBajando(true);
    for (const { href } of ARCHIVOS) {
      const a = document.createElement("a");
      a.href = href;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 800));
    }
    setBajando(false);
  };

  return (
    <button
      type="button"
      onClick={bajar}
      disabled={bajando}
      className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1B3D] px-4 py-2 text-[12.5px] font-bold text-white hover:bg-[#13308C] disabled:opacity-60"
    >
      <span aria-hidden>🗄️</span>
      {bajando ? "Descargando…" : "Descargar respaldo completo (6 archivos)"}
    </button>
  );
}

"use client";
// Telemetría de navegación (0064): registra qué sección abre el usuario logueado,
// para auditar la capacitación del personal (pantalla /admin/uso, dev-gated).
// Fire-and-forget: nunca bloquea ni rompe la UI, tolera fallos de red.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function RegistroUso() {
  const pathname = usePathname();
  const ultimo = useRef<string>("");
  useEffect(() => {
    if (!pathname || pathname === ultimo.current) return;
    ultimo.current = pathname;
    try {
      fetch("/api/uso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* sin red / SSR: ignorar */
    }
  }, [pathname]);
  return null;
}

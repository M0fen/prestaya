"use client";
// Marca el canal abierto como leído (limpia el badge de no leídos) al montar y
// al cambiar de canal. Refresca una vez para reflejar el badge en cero. No
// renderiza nada. El deps [canal] evita un loop: el refresh no cambia el canal.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { marcarCanalLeido } from "@/lib/acciones/chat";

export function MarcarLeido({ canal, hayNoLeidos }: { canal: string; hayNoLeidos: boolean }) {
  const router = useRouter();
  const hecho = useRef<string | null>(null);

  useEffect(() => {
    if (hecho.current === canal) return;
    hecho.current = canal;
    void marcarCanalLeido(canal).then(() => {
      // Solo refresca si había algo por leer (evita refresh innecesario).
      if (hayNoLeidos) router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal]);

  return null;
}

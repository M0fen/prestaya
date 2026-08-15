// ─────────────────────────────────────────────────────────────────────────
//  La DECISIÓN del banner offline/copia-vieja, pura (caso MOREIRA, 15-08).
//
//  Dos señales, no una: `navigator.onLine` dice "hay red" aunque la red no
//  conteste — con LTE flaca el fetch falla, el SW sirve la COPIA guardada y
//  Edward vio "0/24 cubiertos" que el servidor tenía en 3/24, sin marca alguna
//  de que era viejo. La regla vive acá para que un refactor del componente no
//  pueda invertirla con la suite en verde: el caso crítico es copiaVieja CON
//  onLine=true — el teléfono se cree conectado y la pantalla es de ayer.
// ─────────────────────────────────────────────────────────────────────────

export interface EstadoBanner {
  mostrar: boolean;
  titulo: string | null;
  detalle: string | null;
  /** El botón "Actualizar" SOLO cuando hay red que probablemente conteste. */
  conBotonActualizar: boolean;
}

export function estadoBanner(offline: boolean | null, copiaVieja: boolean): EstadoBanner {
  // `offline === null` = primer render (SSR no sabe): no parpadear.
  if (!offline && !copiaVieja) return { mostrar: false, titulo: null, detalle: null, conBotonActualizar: false };
  return offline
    ? {
        mostrar: true,
        titulo: "Sin conexión",
        detalle:
          "Estás viendo tu última ruta guardada. Tus cobros se guardan y se envían solos cuando vuelva la señal.",
        conBotonActualizar: false, // sin red, recargar solo re-sirve la misma copia
      }
    : {
        mostrar: true,
        titulo: "Sin respuesta de la red",
        detalle:
          "Estás viendo una copia GUARDADA de esta pantalla: los pagos y el cartón pueden estar viejos. Tus cobros se guardan igual y se envían solos.",
        conBotonActualizar: true,
      };
}

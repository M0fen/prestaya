// ─────────────────────────────────────────────────────────────────────────
//  estadoBanner — la regla del caso MOREIRA. El caso crítico: copia vieja
//  CON el teléfono creyéndose conectado (onLine=true) TIENE que mostrarse —
//  era exactamente la pantalla "0/24" sin ninguna marca de vejez.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { estadoBanner } from "./estadoBanner";

describe("estadoBanner", () => {
  it("EL CASO MOREIRA: copia vieja con el teléfono 'en línea' → banner CON botón Actualizar", () => {
    const b = estadoBanner(false, true);
    expect(b.mostrar).toBe(true);
    expect(b.titulo).toBe("Sin respuesta de la red");
    expect(b.detalle).toMatch(/copia GUARDADA/);
    expect(b.conBotonActualizar).toBe(true); // hay red: reintentar puede traer lo fresco
  });

  it("sin conexión franca → banner SIN botón (recargar re-serviría la misma copia)", () => {
    const b = estadoBanner(true, false);
    expect(b.mostrar).toBe(true);
    expect(b.titulo).toBe("Sin conexión");
    expect(b.detalle).toMatch(/se envían solos/); // los cobros no se pierden: el mensaje calma
    expect(b.conBotonActualizar).toBe(false);
  });

  it("offline Y copia vieja a la vez: manda el estado de conexión (el mensaje de offline)", () => {
    const b = estadoBanner(true, true);
    expect(b.titulo).toBe("Sin conexión");
    expect(b.conBotonActualizar).toBe(false);
  });

  it("todo normal (o primer render SSR con null) → nada, sin parpadeo", () => {
    expect(estadoBanner(false, false).mostrar).toBe(false);
    expect(estadoBanner(null, false).mostrar).toBe(false);
  });
});

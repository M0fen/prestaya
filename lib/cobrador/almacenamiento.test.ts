// ─────────────────────────────────────────────────────────────────────────
//  protegerAlmacenamiento — la única defensa contra el desalojo del storage
//  (pérdida TOTAL silenciosa de cobros sin subir). Sin este test, un refactor
//  que borrara la llamada dejaba la calle sin red con la suite en verde.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { protegerAlmacenamiento } from "./almacenamiento";

describe("protegerAlmacenamiento", () => {
  it("pide persist() y devuelve lo que el navegador concedió", async () => {
    const persist = vi.fn(async () => true);
    expect(await protegerAlmacenamiento({ storage: { persist } })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await protegerAlmacenamiento({ storage: { persist: async () => false } })).toBe(false);
  });

  it("API ausente o rota → null, jamás lanza (best-effort de arranque)", async () => {
    expect(await protegerAlmacenamiento({})).toBeNull();
    expect(await protegerAlmacenamiento({ storage: {} })).toBeNull();
    expect(
      await protegerAlmacenamiento({ storage: { persist: () => Promise.reject(new Error("nope")) } }),
    ).toBeNull();
  });

  it("SyncEngine (el layout del cobrador) la INVOCA: la defensa está cableada", () => {
    // Estático a propósito (no hay tests de componentes en el repo): ata que el
    // punto de arranque real llama a la función testeada de arriba.
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const src = readFileSync(join(raiz, "components", "cobrador", "SyncEngine.tsx"), "utf8");
    expect(src).toContain("protegerAlmacenamiento");
  });
});

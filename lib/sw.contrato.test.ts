// ─────────────────────────────────────────────────────────────────────────
//  CONTRATO service worker ↔ OfflineBanner (caso MOREIRA, 15-08).
//  El SW avisa {tipo:"copia-servida"} cuando sirve una página VIEJA del caché
//  y el banner lo muestra ("Sin respuesta de la red … Actualizar"). Son dos
//  archivos que no se importan entre sí: un bump de versión del SW que pierda
//  el aviso, o un rename del tipo del mensaje, rompía el arreglo EN SILENCIO
//  con toda la suite en verde. Este test estático ata las dos puntas.
// ─────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(raiz, "public", "sw.js"), "utf8");
const banner = readFileSync(join(raiz, "components", "cobrador", "OfflineBanner.tsx"), "utf8");

describe("contrato sw.js ↔ OfflineBanner", () => {
  it("el SW avisa 'copia-servida' en los DOS caminos que sirven caché (navegación y RSC)", () => {
    // Ambos .catch de la ruta del cobrador tienen que pasar por servirCopia
    // (que es quien avisa), no por un caches.match pelado.
    const usosServirCopia = sw.match(/servirCopia\(/g) ?? [];
    expect(usosServirCopia.length).toBeGreaterThanOrEqual(3); // definición + 2 usos
    expect(sw).toContain('"copia-servida"');
    // El fallback pelado (sin aviso) no debe volver: un catch que sirva la COPIA
    // de una página real (caches.match(req…)) sin pasar por servirCopia enciende
    // el caso Moreira de nuevo. La página amable de offline (OFFLINE_URL) es un
    // placeholder, no datos viejos: esa sí puede ir pelada.
    const catchesConCopiaPelada = sw.match(/catch\([^)]*\)\s*=>\s*caches\.match\(req/g) ?? [];
    expect(catchesConCopiaPelada).toHaveLength(0);
  });

  it("el banner escucha EXACTAMENTE el mismo tipo de mensaje", () => {
    expect(banner).toContain('"copia-servida"');
    expect(banner).toMatch(/serviceWorker/);
  });

  it("la versión del caché sigue siendo la del arreglo (bump consciente, no accidental)", () => {
    // Si esto falla porque subiste la versión A PROPÓSITO, actualizá el test:
    // es el recordatorio de que el aviso copia-servida debe sobrevivir al bump.
    expect(sw).toContain('"presta-ya-v4"');
  });
});

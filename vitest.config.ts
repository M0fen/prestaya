import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resuelve el alias "@/..." igual que Next.js, para que los tests puedan
// importar módulos por ruta absoluta del proyecto.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});

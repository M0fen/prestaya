import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Suite de INTEGRACIÓN: corre los RPC/triggers/RLS reales contra un Postgres de
// verdad (clúster efímero local o DATABASE_URL en CI). Separada del suite rápido
// (`npm test`) porque levanta una base y es más lenta. Un solo fork y sin
// paralelismo de archivos: comparten una única base migrada; el aislamiento por
// test lo da withRollback (transacción revertida).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/pg/**/*.pg.test.ts"],
    globalSetup: ["test/pg/globalSetup.ts"],
    setupFiles: ["test/pg/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 90000,
    pool: "forks",
    // Un solo worker (v4): comparten una única base migrada; el aislamiento por
    // test lo da withRollback. Evita que dos archivos toquen la base a la vez.
    maxWorkers: 1,
    fileParallelism: false,
  },
});

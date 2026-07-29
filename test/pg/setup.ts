// setupFiles de la suite de integración: cierra el Pool al terminar cada
// archivo para que vitest no reporte handles abiertos.
import { afterAll } from "vitest";
import { closePool } from "./db";

afterAll(async () => {
  await closePool();
});

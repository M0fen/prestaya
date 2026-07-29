// Aplica el SHIM de Supabase + TODAS las migraciones reales de producción a una
// base recién creada, y devuelve la URL de esa base. Igual que `supabase db
// reset`, difiere la validación de cuerpos de funciones (check_function_bodies)
// a runtime, porque una función SQL puede referenciar columnas creadas por una
// migración posterior. Si una migración falla, lanza con el archivo culpable.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const SHIM = join(HERE, "shim.sql");

let contador = 0;

/** Crea una base fresca en el servidor `adminUrl`, la migra y devuelve su URL. */
export async function migrarBaseFresca(adminUrl: string): Promise<string> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const nombre = `prestaya_test_${Date.now().toString(36)}_${contador++}`;
  await admin.query(`create database ${nombre}`);
  await admin.end();

  const url = adminUrl.replace(/\/[^/]+(\?|$)/, `/${nombre}$1`);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    // Difiere la validación de cuerpos SQL a runtime (ver 0040 vs 0041).
    await c.query("set check_function_bodies = false");
    await c.query(readFileSync(SHIM, "utf8"));

    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of archivos) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      try {
        await c.query(sql);
      } catch (e) {
        throw new Error(`Migración ${f} falló: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
  return url;
}

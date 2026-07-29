// globalSetup de vitest para la suite de integración PG. Se ejecuta UNA vez
// antes de todos los archivos *.pg.test.ts:
//   · Si hay DATABASE_URL (CI con `services: postgres`), migra una base fresca ahí.
//   · Si no, levanta un clúster efímero desde los binarios locales de Postgres.
// Publica la URL final en process.env.PG_TEST_URL (los workers la heredan al
// forkearse). Devuelve un teardown que apaga el clúster efímero.
import { bootCluster } from "./cluster";
import { migrarBaseFresca } from "./migrate";

export default async function setup() {
  let stop: () => void = () => {};
  let adminUrl = process.env.DATABASE_URL;

  if (!adminUrl) {
    const cluster = await bootCluster();
    adminUrl = cluster.url;
    stop = cluster.stop;
  }

  const url = await migrarBaseFresca(adminUrl);
  process.env.PG_TEST_URL = url;

  return async () => {
    stop();
  };
}

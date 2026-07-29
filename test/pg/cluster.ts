// ─────────────────────────────────────────────────────────────────────────
//  Clúster de Postgres EFÍMERO para tests de integración (sin Docker).
//  Usa los binarios de PostgreSQL instalados (initdb/pg_ctl) para levantar un
//  clúster desechable en un dir temporal, lo migra y lo destruye al terminar.
//
//  En CI (Linux) NO se usa esto: se pasa DATABASE_URL de un `services: postgres`
//  y el harness se conecta ahí directamente (ver globalSetup.ts).
// ─────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const PG_BIN =
  process.env.PG_BIN ||
  (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "/usr/lib/postgresql/17/bin");

function exe(name: string): string {
  return process.platform === "win32" ? join(PG_BIN, `${name}.exe`) : join(PG_BIN, name);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export type Cluster = { url: string; stop: () => void };

/** Levanta un clúster efímero y devuelve su URL de conexión + un stop(). */
export async function bootCluster(): Promise<Cluster> {
  if (!existsSync(exe("initdb"))) {
    throw new Error(
      `No se encontró initdb en ${PG_BIN}. Instalá PostgreSQL o exportá PG_BIN / DATABASE_URL.`,
    );
  }
  const work = mkdtempSync(join(tmpdir(), "prestaya-pg-"));
  const data = join(work, "data");
  const port = await freePort();
  const pwfile = join(work, "pw.txt");
  writeFileSync(pwfile, "postgres");

  execFileSync(exe("initdb"), ["-D", data, "-U", "postgres", `--pwfile=${pwfile}`, "-E", "UTF8"], {
    stdio: "ignore",
  });

  // fsync=off + full_page_writes=off: es desechable, priorizamos velocidad.
  execFileSync(
    exe("pg_ctl"),
    [
      "-D", data,
      "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off`,
      "-l", join(work, "pg.log"),
      "-w", "start",
    ],
    { stdio: "ignore" },
  );

  const stop = () => {
    try {
      execFileSync(exe("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    } catch {
      /* ya caído */
    }
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* Windows a veces retiene el lock; se limpia con el temp */
    }
  };

  return { url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, stop };
}

// Qué commit es este build (lo escribe scripts/build-info.mjs antes de
// compilar). Si Vercel algún día inyecta el sha (integración git), gana ese.
import info from "./build-info.json";

export interface BuildInfo {
  sha: string | null;
  shaCorto: string | null;
  rama: string | null;
  fechaCommit: string | null;
  mensaje: string | null;
  sucio: boolean;
  generadoEn: string | null;
}

const archivo = info as Partial<BuildInfo>;
const shaEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

export const BUILD: BuildInfo = {
  sha: shaEnv ?? archivo.sha ?? null,
  shaCorto: (shaEnv ?? archivo.sha ?? "").slice(0, 7) || null,
  rama: process.env.VERCEL_GIT_COMMIT_REF ?? archivo.rama ?? null,
  fechaCommit: archivo.fechaCommit ?? null,
  mensaje: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? archivo.mensaje ?? null,
  sucio: !!archivo.sucio,
  generadoEn: archivo.generadoEn ?? null,
};

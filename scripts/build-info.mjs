#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  build-info: deja en lib/build-info.json QUÉ commit es este build, para que
//  el panel del piloto diga qué está sirviendo prod (el deploy es manual con
//  `vercel --prod` y Vercel no inyecta el sha sin integración git).
//
//  Corre como `prebuild` (npm run build) y en `npm run deploy`. En la build de
//  Vercel no hay `.git`: entonces NO toca el archivo (queda el que se generó en
//  la PC justo antes de subir, que es el correcto). Nunca falla la build.
// ─────────────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "lib", "build-info.json");

function git(args) {
  return execSync(`git ${args}`, { cwd: raiz, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

try {
  const sha = git("rev-parse HEAD");
  const info = {
    sha,
    shaCorto: sha.slice(0, 7),
    rama: git("rev-parse --abbrev-ref HEAD"),
    fechaCommit: git("log -1 --format=%cI"),
    mensaje: git("log -1 --format=%s").slice(0, 160),
    // "sucio" = cambios reales sin commitear; este mismo archivo no cuenta
    // (se regenera en cada deploy y siempre difiere del commit anterior).
    sucio: git("status --porcelain -- . ':!lib/build-info.json'").length > 0,
    generadoEn: new Date().toISOString(),
  };
  writeFileSync(destino, JSON.stringify(info, null, 2) + "\n");
  console.log(`build-info: ${info.shaCorto} (${info.rama})${info.sucio ? " +cambios sin commitear" : ""}`);
} catch {
  if (existsSync(destino)) {
    const previo = JSON.parse(readFileSync(destino, "utf8"));
    console.log(`build-info: sin git acá, queda ${previo.shaCorto ?? "?"}`);
  } else {
    writeFileSync(
      destino,
      JSON.stringify({ sha: null, shaCorto: null, rama: null, fechaCommit: null, mensaje: null, sucio: false, generadoEn: new Date().toISOString() }, null, 2) + "\n",
    );
    console.log("build-info: sin git y sin archivo previo → desconocido");
  }
}

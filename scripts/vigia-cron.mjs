#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  VIGÍA DEL VIGILANTE (dead-man's switch) — SOLO LECTURA.
//
//  El problema que resuelve: si el cron de Vercel muere, el silencio parece
//  verde — nadie corre INV1-15 y nadie se entera (Vercel ya estuvo 11 h sin
//  publicar deploys sin avisar; el cron es la misma infraestructura). Este
//  script corre DESDE OTRO LADO (GitHub Actions, .github/workflows/vigia.yml)
//  y falla ruidosamente si:
//   · la última corrida de reconciliacion_log tiene más de 30 h (cron muerto), o
//   · el último respaldo lógico registrado en backups_log tiene más de 8 días.
//  GitHub manda mail al dueño del repo cuando un workflow programado falla.
//
//  Uso local:   node --env-file=.env.local scripts/vigia-cron.mjs
//  En Actions:  necesita el secret SUPABASE_DB_URL (Settings → Secrets).
// ─────────────────────────────────────────────────────────────────────────
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Falta SUPABASE_DB_URL (secret del repo o --env-file=.env.local).");
  process.exit(1);
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const fallas = [];

// 1 · ¿Los vigilantes nocturnos corrieron? (cron de Vercel, 10:00Z)
{
  const { rows } = await db.query(
    "select corrida_en, criticos from reconciliacion_log order by corrida_en desc limit 1",
  );
  if (!rows.length) {
    fallas.push("reconciliacion_log está VACÍO: los vigilantes jamás corrieron.");
  } else {
    const horas = (Date.now() - new Date(rows[0].corrida_en).getTime()) / 3_600_000;
    console.log(`vigilantes: última corrida hace ${horas.toFixed(1)} h (críticos: ${rows[0].criticos})`);
    if (horas > 30) fallas.push(`los vigilantes NO corren hace ${horas.toFixed(0)} h — ¿el cron de Vercel murió?`);
  }
}

// 2 · ¿El respaldo lógico local sigue corriendo? (backup-completo.mjs → backups_log)
{
  try {
    const { rows } = await db.query(
      "select corrido_en from backups_log order by corrido_en desc limit 1",
    );
    if (!rows.length) {
      fallas.push("backups_log está VACÍO: nunca corrió backup-completo.mjs.");
    } else {
      const dias = (Date.now() - new Date(rows[0].corrido_en).getTime()) / 86_400_000;
      console.log(`respaldo lógico: último hace ${dias.toFixed(1)} días`);
      if (dias > 8) fallas.push(`el último respaldo lógico tiene ${dias.toFixed(0)} días — correr backup-completo.mjs.`);
    }
  } catch {
    console.log("respaldo lógico: backups_log no existe todavía (se salta).");
  }
}

await db.end();

if (fallas.length) {
  console.error("\n🔴 VIGÍA EN ROJO:");
  for (const f of fallas) console.error("   · " + f);
  process.exit(1);
}
console.log("\n🟢 Vigía en verde: vigilantes y respaldos con pulso.");

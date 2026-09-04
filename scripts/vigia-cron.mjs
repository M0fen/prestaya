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

// 1 · ¿Los vigilantes nocturnos corrieron Y dijeron algo cierto?
//
// ⚠️ Este chequeo medía SOLO EL PULSO: que la corrida existiera y fuera reciente.
// Resultado: 39 corridas seguidas con ok=false y 555 críticos durante 19 días, y
// el vigía imprimiendo "🟢 en verde" todas las mañanas. Un watchdog que solo
// verifica que el otro watchdog respire no sirve de nada si lo que el otro dice
// es "hay 555 problemas". Ahora se mira también el CONTENIDO.
{
  const { rows } = await db.query(
    "select corrida_en, criticos from reconciliacion_log order by corrida_en desc limit 6",
  );
  if (!rows.length) {
    fallas.push("reconciliacion_log está VACÍO: los vigilantes jamás corrieron.");
  } else {
    const horas = (Date.now() - new Date(rows[0].corrida_en).getTime()) / 3_600_000;
    const criticos = Number(rows[0].criticos ?? 0);
    console.log(`vigilantes: última corrida hace ${horas.toFixed(1)} h (críticos: ${criticos})`);
    if (horas > 30) fallas.push(`los vigilantes NO corren hace ${horas.toFixed(0)} h — ¿el cron de Vercel murió?`);

    // (a) ¿SUBIÓ respecto de anoche? Lo heredado del empalme del 17-08 es un
    //     stock conocido; lo que importa es que no crezca. Comparar contra la
    //     corrida anterior no necesita mantener ningún número a mano.
    const previo = rows[1] ? Number(rows[1].criticos ?? 0) : null;
    if (previo != null && criticos > previo) {
      fallas.push(
        `los críticos SUBIERON de ${previo} a ${criticos} desde anoche: aparecieron ${criticos - previo} casos NUEVOS.`,
      );
    }

    // (b) ¿La métrica está CONGELADA? Un número idéntico cinco corridas seguidas,
    //     mientras entran pagos todos los días, no es una cartera estable: es un
    //     sensor trabado. Es exactamente lo que pasó con 292 durante 11 días y
    //     con 608 durante 19.
    const ultimos = rows.slice(0, 5).map((r) => Number(r.criticos ?? 0));
    if (ultimos.length === 5 && new Set(ultimos).size === 1 && ultimos[0] > 0) {
      fallas.push(
        `los críticos valen exactamente ${ultimos[0]} en las últimas 5 corridas: la métrica está congelada — ¿el RPC devuelve siempre lo mismo o el log se está reescribiendo?`,
      );
    }
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
console.log("\n🟢 Vigía en verde: vigilantes con pulso, sin críticos nuevos, y respaldos al día.");

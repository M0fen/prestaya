# Cadencia de QA — la rutina, con dueño

> Institucionaliza el Plan Maestro de QA (Fase 5, 15-08-2026). Cada fila tiene
> UN comando y UN dueño. Si una corrida sale roja, es un incidente del día,
> no backlog.

| Cuándo | Qué corre | Comando | Dueño |
|---|---|---|---|
| **Cada cambio** | Tipos + suite completa + build. Sin verde no hay commit. | `npx tsc --noEmit && npx vitest run --no-file-parallelism && npm run build` | automático (Claude en cada sesión) |
| **Cada migración** | Harness PG: TODAS las migraciones reales + 70 tests de RPCs/RLS/triggers/caos. Cazó que 0142 mató el reparador → confiar en él. | `npm run test:pg` | automático (Claude en cada sesión) |
| **Cada deploy** | Sonda con sesión real contra prod buscando un marcador FUNCIONAL del commit (strings ASCII en los chunks). "prod 200" no prueba nada: Vercel ya estuvo 11 h sin publicar sin avisar. | probe ad-hoc (`playwright-core` + `CHROME_PATH`) | Claude, tras cada `npx vercel --prod` de Carlos |
| **Diario 07:00 UY** | Vigilantes INV1–15 sobre ayer (cron 10:00Z). Baseline conocido en `scripts/tablero-qa.mjs`; lo que SUPERE el baseline es del día. | cron ya instalado · revisar con el tablero | Carlos (mirada de 1 min) |
| **Diario 09:00 UY (externo)** | Vigía dead-man's-switch: ¿vigilantes y respaldos siguen corriendo? Falla → mail de GitHub. | `.github/workflows/vigia.yml` (secret `SUPABASE_DB_URL`) | GitHub Actions |
| **Cada 15 min en jornada (07–22 h)** | Respaldo incremental del libro (RPO ≤15 min sin PITR). PROGRAMADO e invisible (tarea `PrestaYa-respaldo-libro` → `respaldo-libro-oculto.vbs`, log en `respaldos-libro/registro.log`). | corre solo · verificar: `node --env-file=.env.local scripts/respaldo-libro.mjs --verificar` | hecho 16-08 |
| **Semanal (respaldo)** | Respaldo lógico completo + verificación (el vigía grita si pasan 8 días). | `backup-completo.mjs` → `verificar-backup.mjs` | Carlos / sesión de Claude |
| **Semanal** | «Un día en la vida» (22 paradas, pantalla vs base, solo lectura) + el tablero de métricas. | `node scripts/dia-en-la-vida.mjs && node scripts/tablero-qa.mjs` | Claude (Carlos puede correrlo solo) |
| **Por release grande** | Sesión de caos: el arsenal adversarial §6 del plan, mapeado contra la evidencia y ejecutado. El acta del 15-08 es el molde. | multi-agente + `test/pg/caos.pg.test.ts` | Claude |
| **Mensual** | Comisiones de la quincena recalculadas por fuera y comparadas · poda de tests que sellan reglas derogadas (se reescriben con el porqué, no se borran). | ad-hoc (canal SQL solo lectura) | Claude + Carlos |
| **Mientras dure el paralelo** | Drift de cartera vs el EXPORT de Disapp (nunca contra su dashboard: esconde vencidos). | `empalme`-tooling, solo lectura | Carlos exporta · Claude compara |

## El tablero (`node scripts/tablero-qa.mjs`)

Solo lectura contra la base viva, corre en segundos. Sale **rojo (exit 1)** si
algo se movió fuera de lo conocido:

- Invariantes de los vigilantes vs **baseline del 15-08** (292 sobrecobros del
  empalme, ~217 zombies de Renovar, 1 gasto sin egreso de Valentina).
- **El candado trabaja**: frenos de doble cobro/colocación en 7 días (rastro en
  `auditoria` desde el 15-08). Un 0 sostenido por semanas = candado muerto.
- Pedidos pendientes > 24 h (renovación/gasto/anulación) — si crecen, la cola
  se está resolviendo por WhatsApp otra vez.
- Jornadas con base y sin acta > 48 h — plata durmiendo en bolsillos.
- Incidencias 🐞 y discrepancias de dinero sin resolver.
- Adopción: bases cargadas hoy/ayer vs cobradores activos.

## Reglas de oro (aprendidas acá, con sangre)

1. **«Verificado» sin evidencia ejecutada vale cero.** Se ejecuta el caso, se
   mide, recién ahí se afirma.
2. **Medir contra la base viva antes de arreglar.** Los lectores exageran
   magnitudes hasta 85×; la consulta de solo lectura decide el tamaño real.
3. **Toda columna nueva se verifica con `information_schema`; toda policy
   contra `pg_policies`.** El repo dice lo que DEBERÍA haber; la base, lo que HAY.
4. **Los tests-espejo drifean.** Un predicado de negocio se EXPORTA de su módulo
   y el test lo IMPORTA — nunca una copia (el candado del doble cobro fijó la
   regla vieja durante semanas con los tests en verde).
5. **Todo hallazgo pasa por un refutador adversarial** antes de gastar tiempo en
   arreglarlo; todo arreglo, por un lente que intenta romperlo antes de commitear.
6. **El deploy se prueba con un marcador funcional del commit, con sesión real.**
7. **Toda regla nueva de negocio entra con su test y su invariante el mismo día.**

## Dónde vive cada cosa

- Plan maestro (artifact): `Plan Maestro QA` — las 8 categorías del arsenal §6.
- Acta de la sesión de caos 15-08 (artifact): `Acta de Caos` — 30 ataques con
  veredicto y evidencia; el backlog priorizado sale de ahí.
- Tests de caos contra Postgres real: `test/pg/caos.pg.test.ts`.
- E2E de solo lectura: `scripts/dia-en-la-vida.mjs` · Tablero: `scripts/tablero-qa.mjs`.

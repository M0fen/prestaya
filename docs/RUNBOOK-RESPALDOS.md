# RUNBOOK — Respaldos y fidelidad de los datos (Presta Ya)

> **Regla de oro: un respaldo no verificado es una esperanza, no un respaldo.**
> Acá está TODO el sistema: qué protege cada capa, cómo se corre, cómo se
> restaura, y qué revisar cada semana. Actualizado 2026-08-03.

---

## 1. Contra qué nos protegemos (escenarios)

| # | Escenario | Qué lo cubre | Pérdida máxima de datos (RPO) |
|---|-----------|--------------|-------------------------------|
| 1 | UPDATE/DELETE accidental o malicioso por la API | **Triggers de inmutabilidad** (0118/0120/0121/0124/**0126**) — lo bloquean ANTES de que pase | 0 (no ocurre) |
| 2 | Corrupción lógica (un bug escribe mal) | **Invariantes INV1–INV10** (cron diario 07:00) + panel Empalme | detectada < 24 h |
| 3 | Migración destructiva / error humano en SQL Editor | **PITR de Supabase** (👉 activarlo, ver §4) | ~2 min con PITR; hasta 24 h sin él |
| 4 | Caída/borrado del proyecto Supabase, ransomware de la cuenta | **Respaldo lógico propio + copia OFFSITE** (§3) | desde el último respaldo (correrlo a diario ⇒ ≤ 24 h) |
| 5 | Región de Supabase caída | Respaldo lógico → restaurar en proyecto nuevo (§5) | igual que #4 |
| 6 | Robo de la service key | Rotación (§7) + triggers que limitan hasta a service_role (borrar pagos/prestamos exige escotilla en SQL) | — |

La estrategia es **3-2-1**: 3 copias (base viva + respaldo local + copia offsite),
2 medios distintos (Supabase + disco propio), 1 fuera de casa (nube/USB guardado
en otro lado).

---

## 2. Las capas, de adentro hacia afuera

1. **La base no deja perder datos** (esto ya está VIVO tras correr la 0126):
   - `pagos`: no se borran (0120, ni con service_role sin escotilla), campos
     financieros + GPS congelados (0121), **anular es one-way** (0126).
   - `prestamos` (0126): términos congelados por la API (monto/cuota/días/fecha…),
     el estado **solo avanza** (resucitar exige service_role), `pagado_acum` solo
     lo escribe el libro, **borrar vetado** salvo escotilla.
   - `movimientos_caja` inmutable (0118) · `cierres_zona` inmutable (0124) ·
     `clientes.token_acceso` solo rota por la acción del admin (0126).
   - Escotillas (solo SQL Editor, misma transacción, deliberadas):
     `app.permitir_borrado_pagos` · `app.permitir_borrado_prestamos` ·
     `app.permitir_desanulacion`.
2. **El vigilante diario**: cron 07:00 UY corre INV1–INV10 + push si hay crítico.
   El panel `/admin/empalme` grita si el cron lleva >26 h sin correr.
3. **Respaldos de Supabase**: automáticos diarios (plan Pro, retención 7 días).
   Sirven para el escenario #3 si PITR no está. **No son tuyos**: viven en la
   misma cuenta — si la cuenta cae, caen con ella. Por eso existe la capa 4.
4. **Respaldo lógico propio** (`scripts/backup-completo.mjs`): TODO a disco tuyo,
   verificado, con registro en la app. Detalle en §3.
5. **Baseline T0** (migración 0091 + `snapshot-baseline.mjs`): la foto inmutable
   del arranque, para comparar "hoy vs el día que empezamos".

---

## 3. El respaldo lógico propio — operación diaria

```bash
# 1) Correr (1–2 min; 14 MB hoy). Guarda en backups/<fecha>/
node --env-file=.env.local scripts/backup-completo.mjs --retener 14

# 2) VERIFICAR (siempre; marca verificado=true en la app)
node --env-file=.env.local scripts/verificar-backup.mjs backups/<carpeta>

# 3) Copia OFFSITE (elegir una, hacerla SIEMPRE):
#    · arrastrar backups/<carpeta> a Google Drive/OneDrive, o
#    · copiar a un USB que NO queda en la misma casa/oficina.
```

Qué incluye: **las 59 tablas completas** (paginadas con orden estable, gzip,
SHA-256 por archivo), **usuarios de Auth** (id/email/metadata), **inventario de
Storage** (con `--con-archivos` baja también las fotos/comprobantes — correrlo
así 1×/semana). El `manifest.json` registra conteos y hashes; si algo quedó
truncado el respaldo se marca **INCOMPLETO** y la verificación falla — nunca un
respaldo mudo a medias.

Qué verifica `verificar-backup.mjs` (sin tocar la base): hashes y conteos
contra el manifest, huérfanos referenciales (pagos→créditos→clientes),
**INV1 dentro del respaldo** (pagado_acum == Σ pagos: hoy 12.369 créditos,
166.377 pagos, drift=0), ids únicos, montos no negativos, disapp_pago_id sin
duplicados.

**El panel `/admin/empalme` muestra el último respaldo verificado** y se pone
rojo pasados 7 días (tabla `backups_log`, 0126). Cadencia recomendada para el
piloto: **diaria** al cerrar el día (queda el recaudo completo del día adentro).

Caveats honestos:
- **Contraseñas de Auth NO salen por API** (son hashes internos de Supabase). En
  una restauración se recrean los usuarios por email con claves temporales (el
  script imprime el CSV) y cada quien la cambia. Los datos de negocio no pierden nada.
- El respaldo lógico es una foto **eventual-consistente** (lee tabla por tabla
  sobre la base viva). Para el uso real (recuperar el negocio) es correcto; la
  foto transaccional exacta la da PITR.

---

## 4. 👉 PITR — el botón que falta apretar (Carlos, 10 minutos)

El Point-in-Time Recovery es la única capa que permite volver a "las 14:37 de
ayer" con precisión de ~2 minutos. **Pendiente desde el 07-30.**

1. Dashboard Supabase → proyecto (`kvmqlkqfgjimfpzlwsdt`) → **Database → Backups → Point in Time**.
2. Activar PITR (add-on pago; retención 7 días alcanza para el piloto).
3. Anotar en este runbook la fecha de activación.

Sin PITR, el granulado de recuperación de Supabase es el respaldo diario (hasta
24 h de pérdida). Con el respaldo lógico diario nuestro, el peor caso real ya
queda ≤ 24 h — PITR lo baja a minutos.

---

## 5. Restauración (DR) — y el DRILL trimestral

**Nunca practiques el día del incendio.** Una vez por trimestre (agendar):

1. Crear un proyecto Supabase NUEVO (gratis alcanza para el drill).
2. Correr TODAS las migraciones (SQL Editor, en orden; `check_function_bodies=off` si pide).
3. `node scripts/restaurar-backup.mjs backups/<carpeta> --url https://<nuevo>.supabase.co --key <service_del_nuevo> --commit`
   - Se niega solo si el destino es el proyecto de ORIGEN o si ya tiene datos.
   - Restaura en orden de FK con rondas de reintento; re-mapea `auth_user_id`;
     verifica los conteos contra el manifest al final.
4. `node scripts/auditoria-db.mjs` apuntado al proyecto nuevo → debe dar 0 drift.
5. Anotar cuánto tardó (ese es tu **RTO** real) y borrar el proyecto de prueba.

En un desastre real es lo mismo + cambiar las env de Vercel al proyecto nuevo y
repartir el CSV de claves temporales.

---

## 6. Seguridad de acceso (lo que ya está vivo)

- **RLS por zona** en todas las tablas + hardening 0092/0094/0096/0108/0123/0124/0126.
- **EXECUTE a PUBLIC revocado** (0123) + default privileges corregidos — la anon
  key ya no ejecuta nada sensible (verificado en vivo: 42501).
- **Rate-limit de login en dos niveles**: 5/min por IP+cuenta (fuerza bruta) +
  60/min por IP (spraying) — un equipo entero detrás del wifi de la oficina entra.
- **Headers**: CSP estricta, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy mínima.
- Server Actions con gates de rol + kill-switch (`modo_solo_lectura`) en toda
  escritura de plata; idempotencia por `op_id` en todas las escrituras de dinero.
- Tokens de cliente: 48 hex (192 bits, no enumerables), rotables solo por admin.
- Sentry server+edge+browser · auditoría de acciones · bitácora.

## 7. Rotación de claves (cuándo y cómo)

| Clave | Dónde vive | Rotar cuando |
|-------|-----------|--------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env + `.env.local` | sospecha de fuga; al irse alguien con acceso al repo/env |
| `CRON_SECRET` | Vercel env | ídem |
| DeepSeek API key | Vercel env | **pendiente desde 07-18** (estuvo en un chat) |
| Claves de usuarios | Supabase Auth | `PrestaYa2026!` compartida: **que cada quien la cambie en la semana 1** (el reset del admin ya existe) |

Rotar la service key: Dashboard → Settings → API → "Roll" → actualizar Vercel y
`.env.local` → redeploy. Los scripts locales usan `.env.local`, nada más que tocar.

## 8. Checklist

**Diario (2 min):** correr respaldo + verificación (§3) · mirar `/admin/empalme`
(vigilante corriendo, 0 críticas, respaldo al día).
**Semanal:** respaldo con `--con-archivos` · copia offsite confirmada · mirar
`backups_log` en el panel.
**Trimestral:** drill de restauración (§5) · revisar esta tabla de claves.

---

## 9. Actualización 15-08-2026 — el flujo SIN PITR (decisión de costo)

**PITR quedó DESCARTADO por costo** (decisión de Carlos, 15-08). El escenario #3
(migración destructiva / error humano en SQL) pasa a cubrirse así, con lo que el
plan Pro ya incluye más dos piezas propias:

| Capa | Qué cubre | RPO real | Quién la corre |
|---|---|---|---|
| Respaldo diario de Supabase (Pro, 7 días) | catástrofe del día anterior | ≤ 24 h | Supabase, solo |
| `backup-completo.mjs` + `verificar-backup.mjs` | TODO a disco propio, verificado | desde la última corrida | **semanal** (Carlos / sesión de Claude) |
| **`respaldo-libro.mjs` (NUEVO)** — incremental del dinero | pagos/prestamos/caja/rendiciones/auditoría/bitácora NUEVOS + snapshot de solicitudes/aperturas/asignaciones | **≤ 1 h en jornada** | cada hora, Task Scheduler (comando en el encabezado del script) |
| **Vigía externo (NUEVO)** — `.github/workflows/vigia.yml` | que vigilantes y respaldos SIGAN corriendo (el 15-08 cazó 12 días sin respaldo) | — | GitHub Actions, diario 12:00Z · **requiere el secret `SUPABASE_DB_URL` en el repo** |

Cómo se recupera una jornada con esto: restaurar el respaldo diario de Supabase
(o el lógico completo) → aplicar encima los `.jsonl` incrementales del día
(append-only: van en orden de `registrado_en`, el `op_id` deduplica). La pérdida
máxima es lo cobrado en la última hora — y eso además sigue VIVO en la cola
offline de cada teléfono, que re-sincroniza al reconectar.

**El bootstrap importa**: la primera corrida de `respaldo-libro.mjs` solo planta
la marca de agua (la historia ya está en el completo). `--verificar` compara el
tramo cubierto fila a fila contra la base viva.

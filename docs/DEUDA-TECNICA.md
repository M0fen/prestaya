# Registro de deuda técnica — Presta Ya

> Auditoría 2026-08-05 (noche previa al piloto), verificada punto por punto contra
> el sistema real (no especulada). Comparación: qué tendría un equipo fintech
> senior con años de operación, qué tenemos, y qué falta con dueño y plan.
> Actualizar este archivo cuando algo cambie de estado.

## ✅ Lo que YA está al nivel de un equipo serio (verificado hoy)

| Área | Estado |
|---|---|
| CI en GitHub Actions | ✅ tipos + lint + tests + build en cada push, con mutation testing manual |
| TypeScript `strict` | ✅ |
| Tests | ✅ 664 unitarios + 44 integración contra Postgres real (`test:pg`) |
| RLS | ✅ TODAS las tablas public con RLS habilitada (verificado en pg_class) |
| Índices calientes | ✅ pagos/prestamos/asignaciones cubiertos (incl. `idx_pagos_registrador_fecha`) |
| Idempotencia de dinero | ✅ op_id único en pagos/prestamos/caja + verificación de commit ambiguo |
| Conciliación automática | ✅ cron diario 07:00 UY con INV1–INV12 + panel con triage |
| Respaldos | ✅ runbook 3-2-1 verificado con restore real (drift=0) |
| Kill-switch | ✅ modo solo-lectura para congelar escrituras de plata |
| Rate limiting | ✅ login (IP+email), vista cliente, tienda pública (en memoria; ver deuda #4) |
| Headers de seguridad | ✅ CSP estricta, HSTS+preload, noindex de cartones, robots |
| Alertas críticas por email | ✅ Resend + ALERTA_EMAIL_TO configurados en prod |
| Secretos | ✅ service_role solo server; CRON_SECRET seteado |
| Dominio | ✅ prestaya.uy + HTTPS + (SPF/DMARC pendiente de Carlos, abajo) |
| Runbooks | ✅ transición Disapp, piloto, respaldos |
| Dependencias | ✅ Next 15.5.22 (08-05: se parchearon 8 avisos HIGH — ver historial) |

## 🔴 Deuda ABIERTA (por prioridad)

### 1. Sentry apagado — `NEXT_PUBLIC_SENTRY_DSN=""` en producción
**Qué haría un equipo serio:** agregación de errores con alertas (el primer error
repetido del piloto se ve en un dashboard, no buceando logs).
**Hoy:** `reportarError` cae a `console.error` estructurado → queda en los logs de
Vercel (sin agregación, sin alertas, retención corta).
**Plan (5 min, Carlos):** crear el proyecto en sentry.io (Next.js) → copiar el DSN →
avisar para setearlo en Vercel y redeployar. El código ya está instrumentado.

### 2. Deploy automático desconectado (deploys a mano con `vercel --prod`)
**Qué haría un equipo serio:** push a master → CI en verde → deploy automático.
**Hoy:** el CI corre, pero Vercel no recibe pushes desde el 08-04; cada deploy es
manual y un push "en verde" puede quedar sin publicar (ya pasó: 7 commits, 11 h).
**Plan (Carlos):** Vercel → Settings → Git → reconectar el repo. El interlock
natural queda: CI rojo = no mergear.

### 3. PITR (recuperación punto-en-el-tiempo) sin activar
**Qué haría un equipo serio:** en una base que asienta dinero, poder volver a
"hace 7 minutos", no solo al backup diario.
**Plan (decidido 08-04):** activar el tier de 7 días el fin de semana (~$100/mes,
requiere upgrade de cómputo que REINICIA la base → nunca en día de operación).

### 4. Rate limit en memoria por instancia (Upstash sin configurar)
**Hoy:** funciona, pero cada instancia serverless cuenta por separado (el límite
real es límite × instancias).
**Plan (15 min, Carlos):** crear Redis gratis en upstash.com → setear
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` en Vercel. El código ya
tiene el camino distribuido y cae solo.

### 5. Vigilante externo de los crons (dead-man's switch)
**Qué haría un equipo serio:** si el cron de conciliación deja de correr, alguien
se entera por un canal EXTERNO (el panel ya avisa, pero hay que abrirlo).
**Plan (10 min, Carlos):** healthchecks.io o cron-job.org gratis pingueando el
endpoint del cron; si no llega el ping diario, manda email solo.

### 6. 29 políticas RLS sin optimización initplan
**Qué es:** `app_usuario_id()` se evalúa por FILA en vez de una vez por query.
A escala actual no duele; con 13k clientes puede sumar latencia.
**Plan (post-piloto, semana 1):** migración mecánica que envuelve la función en
`(select ...)` en las 29 políticas + corrida del harness PG completo ANTES de
aplicar. NO se hace en caliente ni en día de operación: toca los permisos de
la plata. (Decidido NO tocarlo la noche del arranque.)

### 7. Tipos de la base generados (deuda #2 histórica)
**Qué haría un equipo serio:** `supabase gen types typescript` en CI — el compilador
avisa si una migración desalinea el código.
**Hoy:** tipos a mano en `types/db.ts` (disciplinados, pero sin verificación).
**Plan:** requiere access token de Supabase (Carlos) → luego se agrega el paso a CI.

### 8. `sharp`/libvips con 2 CVE high (transitiva de Next)
**Mitigación real hoy:** en Vercel la optimización de imágenes corre en la infra
de Vercel (no nuestro sharp); no aceptamos SVG de usuarios; las fotos vienen de
nuestro propio bucket. **Plan:** actualizar cuando Next suba la dependencia
(re-chequear `npm audit` semanal).

### 9. FKs de auditoría sin índice (15 columnas tipo `creado_por`)
Columnas frías (solo se consultan al revés en investigaciones). Costo de escribir
15 índices > beneficio hoy. **Plan:** agregar solo si una consulta real lo pide.

### 10. Higiene pendiente de Carlos (5 minutos cada una)
- `NEXT_PUBLIC_SOPORTE_WHATSAPP` + `NEXT_PUBLIC_NEGOCIO_TELEFONO` en Vercel (los
  botones de contacto están escondidos hasta que existan).
- Registros DNS TXT anti-phishing: `@ → "v=spf1 -all"` y `_dmarc → "v=DMARC1; p=reject"`.
- HSTS preload: registrar prestaya.uy en hstspreload.org (opcional).
- MFA del admin: activar 2FA en /admin/seguridad (el soporte ya existe).

### 11. Institucional (sin fecha, pero un equipo serio lo tiene)
- **Legal/compliance UY** (pendiente desde julio): términos, registro de la
  actividad de crédito, protección de datos (Ley 18.331 - URCDP).
- **Política de retención de datos** (cuánto se guarda de clientes dados de baja).
- **Runbook de incidentes** (quién hace qué si se cae en horario de cobro; el
  kill-switch existe, falta el guion de cuándo usarlo).

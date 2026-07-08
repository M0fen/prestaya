# Presta Ya — Blindaje de seguridad nivel senior (master prompt para Claude Code)

> Contexto: Presta Ya es una plataforma de préstamos/cobranza que va a manejar
> datos y dinero reales de ~13.000 personas y ~2.700 créditos activos, con ~47
> cobradores. Antes de entrar data real, hay que cerrar las brechas que un equipo
> senior exigiría en una auditoría. Este prompt cubre lo que se arregla EN CÓDIGO.
> Lo de infraestructura (backups, Sentry, etc.) va en una checklist aparte que
> ejecuta Carlos, NO Claude Code.

## Estado de partida (ya auditado — NO rehacer lo que ya está bien)

Lo siguiente YA está implementado y verificado. NO lo toques salvo para reforzar:
- RLS activo en las 33 tablas.
- `service_role` aislado con `import "server-only"` en los archivos que lo usan.
- Pagos inmutables: insert-only, anulación deja rastro con constraint que exige
  `anulado_por`, `anulado_en`, `motivo_anulacion`. NO rompas esto.
- Rate limiting implementado (`lib/seguridad/rateLimit.ts`): login 5/min, asesor
  20/min, buscar 30/min, reportes 10/min. Cae a memoria si no hay Upstash.
- 2FA/MFA implementado (`lib/seguridad/mfa.ts`) con diseño anti-lockout.
- Idempotencia de pagos con test dedicado.
- TypeScript strict, ~0 `any`, 32 tests.

Tu trabajo NO es reconstruir nada de eso. Es cerrar los huecos de abajo, con la
misma calidad que el código existente. Cada cambio debe venir con su test.

---

## REGLAS DE TRABAJO

1. **No rompas lo que funciona.** Corré `npm run typecheck` y `npm test` antes y
   después de cada fase. Si algún test existente se rompe, parás y reportás.
2. **Cada arreglo lleva su test.** El estándar de este repo es tests reales; mantenelo.
3. **Fallo seguro (fail-closed) en todo lo que sea seguridad.** Ante duda, denegar,
   no permitir. Excepción ya existente y correcta: el MFA falla ABIERTO a propósito
   (anti-lockout) — respetá ese diseño, no lo cambies.
4. **No agregues dependencias pesadas** sin justificar. Zod ya está en el proyecto.
5. Trabajá fase por fase, en orden. Al terminar cada una, resumí qué cambiaste y
   qué test agregaste.

---

## FASE 1 — Validación de entrada en los bordes (Zod)

**Problema:** Zod está en el proyecto pero solo se usa en 2 archivos. Todo endpoint
o server action que reciba datos del mundo exterior (formularios, params, body,
webhooks) debe validar en el borde. Confiar en datos sin validar es la puerta #1 de
inyección y corrupción de datos.

**Tarea:**
- Auditá cada Route Handler (`app/**/route.ts`) y cada Server Action que reciba
  input externo. Listámelos primero.
- Para cada uno, definí un esquema Zod que valide tipo, rango y forma ANTES de tocar
  la base. Montos > 0, documentos con formato, IDs como uuid, textos con longitud
  máxima, enums cerrados.
- Rechazá lo inválido con error claro y sin filtrar detalles internos.
- Centralizá los esquemas reutilizables (ej. `lib/esquemas/`) — ya existe
  `esquemas.test.ts`, seguí ese patrón.
- Test por esquema: caso válido, caso inválido, caso límite.

---

## FASE 2 — Cron de cierre de día: fail-closed en producción

**Problema:** verificá `app/api/cron/**`. Si el cron de cierre de día se ejecuta sin
`CRON_SECRET` (o con secret inválido), NO debe correr en producción — debe rechazar.
Un cron desprotegido es un endpoint que cualquiera puede disparar.

**Tarea:**
- Confirmá que TODO endpoint de cron valida el secret contra `process.env.CRON_SECRET`
  con comparación en tiempo constante.
- En producción (`NODE_ENV === "production"`): si falta el secret o no coincide →
  401, y que NO ejecute la lógica. Fail-closed.
- En dev puede ser más laxo, pero nunca en prod.
- Test: sin secret → rechaza; secret malo → rechaza; secret bueno → ejecuta.

---

## FASE 3 — Cabeceras de seguridad (security headers)

**Problema:** verificá `next.config.js`/`middleware.ts`. Una plataforma comercial
sirve cabeceras de seguridad; sin ellas, quedás expuesto a clickjacking, sniffing y
fugas por referrer.

**Tarea:** configurá (en `next.config` headers o middleware):
- `Content-Security-Policy` (empezá restrictiva; permití solo lo que la app usa:
  Supabase, Leaflet/tiles, Vercel). Documentá cada `allow`.
- `X-Frame-Options: DENY` (anti-clickjacking).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Strict-Transport-Security` (HSTS) para forzar HTTPS.
- `Permissions-Policy` restringiendo APIs que no usás.
- Cuidado: la CSP no debe romper Leaflet ni Supabase. Probá que el mapa y el login
  siguen funcionando. Test o checklist manual de humo.

---

## FASE 4 — Revisión de las políticas RLS por zona (0031)

**Problema:** ya hay RLS por zona (migración 0031, sistema supervisor/zona reciente).
Ese es el punto MÁS delicado: una política mal escrita deja que un supervisor vea
la cartera de otra zona, o que un cobrador vea clientes que no son suyos.

**Tarea (revisión, no reescritura a ciegas):**
- Leé `0030_zonas.sql` y `0031_rls_por_zona.sql`.
- Para cada tabla con RLS por zona, verificá que la política:
  (a) filtra por la zona/rol del usuario autenticado, no por un valor del cliente;
  (b) cubre SELECT, INSERT, UPDATE, DELETE (no solo SELECT);
  (c) las anulaciones de pago siguen siendo admin-only (separación de deberes).
- Escribí tests de aislamiento: usuario de Zona A NO puede leer ni escribir datos de
  Zona B. Cobrador NO puede ver clientes de otro cobrador. Ya existe `permisos.test.ts`
  y `token.test.ts` — seguí ese estilo.
- Si encontrás un hueco, proponé la corrección y esperá OK antes de aplicarla a la
  migración.

---

## FASE 5 — Manejo de errores y fugas de información

**Problema:** en producción, un stack trace o un mensaje de error de Postgres que
llega al cliente le regala al atacante el mapa de tu base.

**Tarea:**
- Revisá que ningún endpoint devuelva al cliente errores crudos de Supabase/Postgres.
- Errores genéricos hacia afuera ("no se pudo procesar"), detalle solo en logs del
  servidor.
- Verificá que no se logueen datos sensibles completos (documentos, tokens de
  cliente) en consola/logs.
- Test de que un input que causa error devuelve mensaje genérico, no el detalle.

---

## FASE 6 — Auditoría de dependencias

**Tarea:**
- Corré `npm audit`. Reportá vulnerabilidades. Arreglá las de prod (`npm audit fix`
  sin `--force` primero). Las de dev, reportá pero no rompas nada por ellas.
- Confirmá que no hay dependencias abandonadas o sin mantener en rutas críticas.

---

## ENTREGABLE FINAL

Al terminar, un resumen: qué se cerró en cada fase, qué tests se agregaron, y una
lista de cualquier hueco que encontraste y NO pudiste cerrar solo (para que Carlos
decida). Corré `npm run typecheck && npm test` al final y confirmá que todo pasa.

---

## FUERA DE ALCANCE DE CLAUDE CODE (esto lo hace Carlos — checklist de infra)

Estas NO son de código, no las intentes; van en la checklist de Carlos:
- [ ] Supabase plan Pro con backups automáticos + Point-in-Time Recovery (PITR).
- [ ] Sentry (o similar) para monitoreo de errores en tiempo real.
- [ ] Alertas de uso/costo en Supabase, Vercel y el proveedor de IA (DeepSeek).
- [ ] Upstash Redis configurado (para que el rate limiting sea distribuido, no solo
      en memoria) — variables `UPSTASH_REDIS_REST_URL` / `_TOKEN`.
- [ ] 2FA obligatorio activado para las cuentas admin.
- [ ] Variables de entorno de producción cargadas en Vercel (CRON_SECRET, claves).
- [ ] Política de rotación de tokens/claves documentada.
- [ ] Prueba de restauración de backup (no basta con tener backup: hay que probar
      que se puede restaurar).

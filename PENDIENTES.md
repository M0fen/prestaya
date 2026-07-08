# Presta Ya — Pendientes de Carlos (acciones manuales)

> Todo lo de **código** está hecho, testeado y desplegado. Esto es lo que
> queda en tu cancha (claves, infra, pruebas) antes de entregar / cargar datos
> reales. Ordenado por prioridad.

---

## 🔴 CRÍTICO — antes de entregar o cargar clientes reales

- [ ] **Rotar `SUPABASE_SERVICE_ROLE_KEY`** (estuvo expuesta).
  - Supabase → Project Settings → **API Keys** → rotar la `service_role`.
  - Actualizarla en **Vercel** (env Production/Preview) y en tu **`.env.local`**.
  - ⚠️ Si Supabase te hace regenerar el *JWT secret*, también rota la `anon` y
    cierra sesiones abiertas: actualizá ambas claves y volvé a loguearte.
  - Redeploy después de cambiarla.

- [ ] **Rotar `DEEPSEEK_API_KEY`** (estuvo expuesta).
  - DeepSeek → API Keys → revocar la actual + crear una nueva.
  - Actualizar en **Vercel** + **`.env.local`**. Redeploy.

- [ ] **Borrar los datos DEMO de producción** (cuando le des el visto bueno).
  ```bash
  node --env-file=.env.local scripts/seed-demo-operador.mjs --limpiar
  # y si en su momento corriste los otros seeds:
  node --env-file=.env.local scripts/seed-demo-datos.mjs --limpiar
  node --env-file=.env.local scripts/seed-demo.mjs --limpiar
  ```
  (Todo lo demo está marcado con 🧪 / `[demo-operador]`.)

---

## 🟠 IMPORTANTE — para activar features ya construidas

- [ ] **Correr migración `0034`** (rol Desarrollador) en el SQL Editor. Después:
  ```bash
  node --env-file=.env.local scripts/marcar-dev.mjs carlos@prestaya.uy
  ```
  (activa tu rol desarrollador sin cambiarte la contraseña).

- [x] **Migración `0035`** (RLS por zona — cerrar escrituras cruzadas) — **CORRIDA
  ✓ (2026-07-07)**. Hallazgo de la auditoría senior: 0031 acotó por zona la lectura
  y la edición, pero dejó los INSERT de `pagos`/`prestamos`/`visitas` en nivel
  "cualquier gestor". Ya cerrado: un supervisor NO puede insertar sobre un cliente
  de otra zona, ni por PostgREST directo.
  - Verificación opcional: sección **§7** de `docs/pruebas-seguridad-zona.md`.

- [ ] **Cambiar las contraseñas temporales** del equipo (Mauricio / Carolina /
  Carlos) al primer ingreso — te las pasé por chat, son provisorias.

- [ ] **Notificaciones push (PWA)** — hoy NO están activas (faltan claves):
  1. Generar VAPID: `node scripts/gen-vapid.mjs`
  2. Cargar en **Vercel** (Production + Preview): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
     `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  3. Redeploy.

- [ ] **`CRON_SECRET` en Vercel** — el cron "Cierre del día" ahora **falla
  cerrado** en producción (blindaje Fase 2): sin este secreto responde 401 y no
  manda el aviso. Seteá `CRON_SECRET` en Vercel (Vercel Cron lo manda solo en el
  header). Va de la mano con las VAPID de arriba.

- [ ] **Activar y probar el 2FA (Fase 5)**:
  1. Verificar que TOTP esté habilitado en **Supabase → Auth → MFA**.
  2. Entrar a **`/admin/seguridad`**, activar tu 2FA (escanear el QR con Google
     Authenticator / Authy).
  3. **Cerrar sesión y volver a entrar** para probar el paso del código.
  4. Que tu esposa (el otro admin) haga lo mismo.
  5. Avisame si querés que lo deje **obligatorio** para todo admin (1 línea).
  - Recuperación si alguien pierde el teléfono: el otro admin lo resetea en
    `/admin/seguridad`.

---

## 🟡 OPCIONAL / RECOMENDADO

- [ ] **Upstash (rate limit distribuido)** — hoy funciona el fallback en memoria
  por instancia; con Upstash pasa a ser distribuido (mejor en Vercel):
  1. Crear BD gratis en Upstash (Redis).
  2. Cargar en Vercel: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

- [ ] **Supabase Pro** — activar **backups + point-in-time recovery** (respaldo
  de la base de dinero).

- [ ] **Smoke test de Aureo** en prod — entrar como gestor y preguntarle algo
  (la key ya está cargada; solo falta probarlo en vivo).

- [ ] **Prueba offline del cobrador** — modo avión, de punta a punta, siguiendo
  `docs/ensayo-offline.md` (encolar sin señal, sincronizar sin duplicar).

- [ ] **Verificar el aislamiento por zona** (si querés estar 100% tranquilo) —
  correr las consultas de `docs/pruebas-seguridad-zona.md` en el SQL Editor.

---

### Estado del código (referencia)
- Blindaje de seguridad: **7/7 fases** + **auditoría senior** (6 fases) · `npm audit`
  = 0 · **236 tests**.
- Auditoría senior: validación en bordes (token .ics), cron con comparación en
  tiempo constante, headers OK, **hallazgo RLS escrituras cruzadas → migración
  0035** (pendiente de correr), fugas de error = limpio.
- Zonas + roles + chat por grupos, tutorial in-app, anulaciones, reasignación:
  hecho y desplegado.
- Migraciones corridas: hasta **0033** + **0035**. Pendiente de correr: **0034**.
- URL pública del operador: `https://prestaya-blush.vercel.app`

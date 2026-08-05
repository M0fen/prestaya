# Runbook del Piloto — Presta Ya

> **Zona Centro** · supervisor **Mauricio Rengifo** + **14 cobradores**.
> Línea base fijada el **2026-07-15**. Producción: `prestaya.uy`.

Este documento es la hoja de ruta para **arrancar el piloto con red de seguridad**:
qué verificar antes del día 1, cómo repartir accesos, la guía del cobrador, la
rutina diaria de control, el freno de emergencia y cómo medimos si salió bien.

---

## ⛔ PRE-VUELO — 2 bloqueantes de infra (verificado en vivo el 2026-07-30)

> **El código y los 3 perfiles están listos.** Lo que falta para arrancar "en serio"
> son **2 cosas que solo puede hacer Carlos en Vercel** (encienden la red de seguridad,
> no el cobro). Se puede COBRAR el día 1 sin esto, pero el vigilante de dinero está apagado.

| # | Bloqueante | Estado hoy (verificado) | Qué hacer |
|---|---|---|---|
| 🔴 1 | **`CRON_SECRET` en Vercel** — enciende la reconciliación diaria automática | ❌ **el cron NUNCA corrió** (última reconciliación: 2026-07-15, hace ~15 días; `reconciliacion_log` solo tiene 1 fila `origen=manual`) | `openssl rand -hex 32` → cargar `CRON_SECRET` en Vercel **Production** → **redeploy** → al otro día verificar una fila `origen='cron'` en `/admin/empalme`. Confirmar que el plan de Vercel corre crons diarios (Pro recomendado). |
| 🔴 2 | **VAPID + suscribir 1 admin** — canal de alerta push | ❌ **0 suscripciones** (aunque el cron corra, un crítico no avisa a nadie) | `node scripts/gen-vapid.mjs` → cargar `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` en Vercel → **redeploy** → un admin toca **"Activar avisos"** en su teléfono. (Mitigado: un crítico ya va SIEMPRE a Sentry aunque el push falle.) |

**✅ Ya resuelto desde el snapshot anterior:** los **13 cobradores sin zona → 0** (custodia sellada).
Núcleo de dinero verificado sólido el 2026-07-29 (`pagado_acum == Σpagos` cuadra, 0 huérfanos, sin drift nuevo).

**Cómo re-verificar este pre-vuelo** (read-only): mirá el banner de `/admin/empalme` (avisa en
rojo si la reconciliación automática lleva >26 h sin correr) y `/admin/dev` (expone si `CRON_SECRET`
está seteado). El resto del backlog de Carlos (PITR, monitor externo, Upstash, legal, 2FA) es
**post-arranque** — endurece, no bloquea.

---

## 0) Estado de preparación (verificado el 2026-07-15)

Corré `node --env-file=.env.local scripts/verificar-piloto.mjs` para regenerar esta foto.

| Chequeo | Estado |
|---|---|
| `eventos_uso` (0064) — observabilidad de adopción | ✅ existe (220 filas), `/admin/uso` operativo |
| Zona Centro: supervisor 1:1 (Mauricio Rengifo) | ✅ |
| 14 cobradores con **login** activo | ✅ todos |
| 14 cobradores con **ruta real** hoy | ✅ 39–83 créditos c/u |
| Coherencia de cartón (2.244 créditos del piloto) | ✅ 0 problemas · 0 sobre-cobros |

**Observación (no bloqueante):** hay **47 cobradores** con login+ruta en total (Norte 7,
Centro 14, Sur 12, "sin zona" 14), no solo los 14 del piloto. En el grupo "sin zona"
aparece *"Administrador Presta Ya"* con ruta de cobro (el admin no debería tener ruta) y
varias "Carteras" VIP de supervisor. **Para un piloto controlado: repartí credenciales
SOLO a los 14 de Zona Centro.** El resto puede quedar accesible pero sin uso dirigido.

### ✅ RESUELTO (2026-07-15) — clientes en DOBLE ruta
Se detectaron **67 clientes con crédito activo asignados a 2 cobradores** (doble ruta),
con **15 colisiones DENTRO de Zona Centro** (dos cobradores del piloto al mismo cliente).
**Consolidado** con `scripts/consolidar-asignaciones.mjs`:
- Regla estable elegida: la asignación **refleja al dueño del crédito** (`prestamos.cobrador_id`,
  fuente de verdad de Disapp → alinea ruteo + comisiones 0069). Se bajaron las asignaciones
  *stale* (activas a un cobrador que no posee ningún crédito activo del cliente), residuo del
  armado de zonas. Se descartó "la más reciente" porque las fechas del import son todas
  iguales → habría bajado al dueño real en 23 casos.
- Resultado: **70 asignaciones stale desactivadas** · **0 clientes orfanados** (guarda de
  seguridad) · **15 colisiones de Centro resueltas** (queda el dueño del crédito) · **8
  doble-ruta legítimas** quedan (cliente con 2 créditos de 2 dueños, 0038; **0 con ambos en
  Centro**). Reversible: log de ids en `scripts/_consolidacion_revert_*.json`.
- Re-verificado: `verificar-piloto.mjs` → **PILOTO LISTO, sin banderas rojas**; 0 invisibles.

### Verificación técnica (2026-07-15)
- `typecheck` ✅ · **357 tests** ✅ · `build` ✅
- Smoke test de producción: `/`, `/ingresar`, `/manifest.webmanifest` → 200 · vista de
  cliente con token inexistente → 200 "no encontrado" (NO filtra datos) ·
  `/api/cron/reconciliacion` sin secreto → **401** (fail-closed) · headers de seguridad
  presentes (CSP, HSTS, X-Frame DENY, nosniff, Referrer-Policy).
- Storage: bucket `anuncios` ✅ existe (gastos con comprobante e imágenes OK).
- Token demo `demo-maria-fernanda`: ✅ **ya purgado** (ausente en la base).
- Cobertura: ✅ **0 clientes activos sin cobrador** (nadie queda invisible).

---

## 1) Línea base del dinero (punto de partida — 2026-07-15)

Fijamos esto **antes** del día 1 para que cualquier alerta nueva del piloto sea un
evento **real y nuevo**, no ruido de arrastre.

### Reconciliación de invariantes — `scripts/reconciliacion.mjs`
- 11.972 créditos · 162.533 pagos vigentes · **0 huérfanos**
- **0 drifts** de `pagado_acum` (los saldos que muestra la app = el libro de pagos)
- 53 sobre-cobros, **todos en créditos FINALIZADOS** (4 materiales + 49 de redondeo) →
  **0 alertables** (0 sobre-cobros materiales en créditos activos)
- Los 4 materiales son baseline del empalme original (créditos ya finalizados cuyas refs
  no están en el export actual de Disapp). Documentados, no disparan push.

### Shadow-mode vs Disapp — `scripts/shadow-disapp.py`
Contra `creditos_2026-07-15_03-03.xlsx`:
- 2.168 créditos activos · 1.978 matcheados con Disapp
- **1.969 EN SYNC** (pagado idéntico) = **99,5%** de los matcheados
- **0 atrás** (no nos faltan recaudos) · 9 adelante por **$22.010 (<0,1%)** → revisar sin urgencia
- Cartera: Presta Ya **$63,56M** vs Disapp **$62,46M** · gap **$1,10M (~1,7%)** =
  diferencia de **modelo** (nuestro cuota×días vs "Saldo Pendiente" con intereses de Disapp),
  **no plata perdida**. (Ítem de código pendiente: decidir si adoptar `total_con_intereses`.)

> **Veredicto de arranque:** la plata cuadra con la app y está en sync con Disapp. ✅

---

## 2) Repartir accesos (día 0)

- **A quién:** solo a los **14 cobradores de Zona Centro** + **Mauricio Rengifo** (supervisor).
- **Login:** email + contraseña. Contraseña común inicial: `PrestaYa2026!`
  (listado email↔nombre: `Desktop/credenciales-prestaya.txt`, o regenerá con
  `node --env-file=.env.local scripts/preparar-emails.mjs`).
- **Instalar la app (PWA):** abrir `prestaya.uy` en el celular →
  menú del navegador → **"Agregar a pantalla de inicio"**. Queda como un ícono más.
- **Probar el primer login en un celular Android real y barato** (no en la compu):
  entrar → ver "Caja del día" → registrar un cobro de prueba → activar modo avión y
  registrar otro (se encola) → volver a datos y ver que sincroniza. **Hacé esto una vez
  antes de repartir**, así descubrís cualquier fricción vos y no ellos en la calle.
- **Activar los avisos del admin** (para el push del cron): con las claves VAPID puestas
  en Vercel (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` —
  generalas con `node scripts/gen-vapid.mjs`), entrá como admin en la PWA y tocá
  **"Activar avisos"**. Sin esto el cron no puede avisarte por push (ver §4).

---

## 3) Guía de arranque del cobrador (1 hoja — imprimir o mandar por WhatsApp)

> **📲 Tu app de cobro — Presta Ya**
>
> **1. Instalá el ícono**
> Abrí `prestaya.uy` en el celular. En el menú del navegador tocá
> **"Agregar a pantalla de inicio"**. Ya tenés la app como un ícono.
>
> **2. Entrá**
> Tu correo y la clave que te dieron. (Si te la piden cambiar, elegí una que recuerdes.)
>
> **3. Tu día empieza en "Caja del día"**
> Ahí está tu ruta de hoy: cada cliente con su cuota. Verde = ya pagó, ámbar = falta.
>
> **4. Cobrar es un toque**
> Tocá el cliente → **Registrar pago**. Si pagó la cuota completa, listo (te queda el
> recibo). Si abonó menos, poné el monto. Si no pagó, marcá **No pagó** y por qué.
>
> **5. Sin señal, seguí trabajando**
> La app **abre y funciona sin internet**: ves tu última ruta guardada (con un aviso
> "sin conexión") y podés cobrar. Los cobros **se guardan igual** y se mandan solos
> cuando vuelve la señal. Nunca pierdas un cobro por falta de datos.
> *Tip:* abrí la app con señal al empezar el día para cargar tu ruta fresca.
>
> **6. Cerrá tu jornada**
> Al final del día, **Cerrar jornada**: la app te dice cuánto cobraste y cuánto entregar.
>
> **¿Algo no anda?** Escribile a tu supervisor por el **chat de la app** (ícono de
> mensajes). No borres ni reinstales: tus datos están a salvo en la nube.
>
> *El domingo no se cobra. Cobramos de lunes a sábado.* 💙

---

## 4) Rutina diaria de control (Carlos)

Cada mañana del piloto, 3 minutos:

1. **Salud del dinero** → abrí **`/admin/empalme`** (o corré
   `node --env-file=.env.local scripts/reconciliacion.mjs`).
   - Verde / 0 críticos = todo cuadra. Seguí.
   - Si aparece un **crítico nuevo** (drift o sobre-cobro material en crédito **activo**),
     es un incidente: mirá la tabla de diferencias (tiene nombre de cliente y monto) y
     rastreá el crédito. El **cron `/api/cron/reconciliacion` (07:00 UY)** registra cada
     corrida en `/admin/empalme` y **empuja un push** si hay algo crítico nuevo.
     - ⚠️ **El push solo llega si:** (a) las claves **VAPID están en Vercel** y (b) **un
       admin activó "Avisos"** en la PWA. Hoy hay **0 admins suscritos** → el push NO
       llega todavía. Igual **nunca se pierde la señal**: la corrida queda en
       `/admin/empalme` y el cron devuelve el resultado en JSON. **Mientras no actives el
       push, revisá `/admin/empalme` a mano cada mañana** (es la fuente de verdad).
2. **Sync con Disapp** → `python scripts/shadow-disapp.py` (con el `creditos_*.xlsx`
   fresco del día en la carpeta `migracion`). Mirá "EN SYNC" y "ADELANTE".
3. **Adopción** → abrí **`/admin/uso`** (solo vos): quién está **Activo / No usó / Nunca
   entró**. Al cobrador que "No usó" a media mañana, un llamado del supervisor.

> **⚠️ NUNCA corras el empalme completo `--commit`.** Re-activa créditos finalizados /
> refinanciados y re-infla la cartera reconciliada. La rutina de arriba es solo LECTURA.

---

## 5) Freno de emergencia (kill switch)

Si algo de dinero se descontrola (un bug de cobro, un sobre-cobro en cadena, un dato
sospechoso masivo):

- **Dónde:** `/admin/empalme` → botón **"Modo solo lectura"** (o el componente KillSwitch).
- **Qué hace:** congela las **escrituras de plata** (registrar pago de cobro, pago de
  panel, cierre de jornada) → la app queda navegable y consultable, pero nadie cobra ni
  mueve plata hasta que lo resuelvas. Es reversible con el mismo botón.
- **Quién decide:** Carlos (o el admin, Mauro). Ante la duda, activalo: es peor seguir
  cobrando con un bug que perder media hora de cobro.
- **Pendiente de código (no bloquea el piloto):** faltan gatear en el kill switch los
  **egresos** (`liquidarComision`, `aprobarGastoRuta`, `registrarMovimientoCaja`). Los
  cobros/cierres ya están gateados. Ver `todos-carlos.md`.

---

## 6) Soporte y feedback

- **Canal del cobrador:** el **chat de la app** (hilo con su supervisor). Mauricio Rengifo
  lo mira durante el día y escala a Carlos lo que sea técnico.
- **Quién mira qué:** supervisor = dudas de uso y ruta; Carlos = bugs / plata / accesos.
- **Registro de fricciones:** anotá cada tropiezo real (dónde se trabaron, qué no
  entendieron). `/admin/uso` muestra además a qué sección fueron y dónde abandonaron —
  eso alimenta el "qué pulir" de la próxima ronda.

---

## 7) Métricas de éxito (decididas de antemano — ventana: 2 semanas)

Al cierre de cada día, mirá:

| Métrica | Meta | De dónde |
|---|---|---|
| Cobradores que registran ≥1 cobro real/día | ≥ 12 de 14 | `/admin/uso` + caja |
| Rutas cerradas con **caja cuadrada** (sin faltante) | ≥ 90% | `/admin/caja` / cierres |
| Discrepancias reportadas por clientes | tendencia a 0 | reportes |
| Críticos nuevos en la reconciliación diaria | **0** | `/admin/empalme` |
| Sync con Disapp (EN SYNC de matcheados) | ≥ 99% | `shadow-disapp.py` |

**Criterio al final de la ventana:** si las metas se sostienen → **ampliar** (sumar Zona
Norte/Sur). Si hay fricción de uso pero la plata cuadra → **ajustar** y extender el piloto.
Si la plata NO cuadra → **parar**, diagnosticar, y no ampliar hasta cerrar el hueco.

---

## 8) Scripts de referencia

| Script | Qué hace | Cómo |
|---|---|---|
| `scripts/verificar-piloto.mjs` | Foto "listo para el día 1" (0064 + estructura + ruta + cartón) | `node --env-file=.env.local scripts/verificar-piloto.mjs` |
| `scripts/reconciliacion.mjs` | Invariantes de dinero (drift / sobre-cobro / huérfanos) — read-only | `node --env-file=.env.local scripts/reconciliacion.mjs` |
| `scripts/shadow-disapp.py` | Diff diario vs export de Disapp — read-only | `python scripts/shadow-disapp.py` |
| `/admin/empalme` | Panel de salud + historial + trazabilidad + kill switch (admin) | navegador |
| `/admin/uso` | Adopción del personal (Activo/No usó/Nunca entró) — dev only | navegador |

> **Nota técnica (2026-07-15):** `reconciliacion.mjs` se corrigió para sumar los pagos en
> **centavos enteros exactos** (antes redondeaba peso-por-peso y reportaba 5 *drifts falsos*
> contra el trigger 0063, que mantiene `pagado_acum` como suma numérica exacta). Ahora usa
> el mismo criterio que el RPC 0071 (desfase crudo ≥ 1 peso = real). El panel/cron nunca
> tuvieron ese bug (suman en SQL). Los ~5 residuos sub-peso del denormalizado son inofensivos
> (bajo el umbral de 1 peso); si querés dejarlos exactos, corré una sola vez en el SQL Editor
> el backfill de 0063: `update prestamos p set pagado_acum = coalesce(s.suma,0) from (select
> prestamo_id, sum(monto) as suma from pagos where anulado=false group by prestamo_id) s where
> s.prestamo_id = p.id;` (es la operación canónica del cache, money-safe e idempotente).

---

## 9) Sentry — monitoreo de errores (paso a paso)

**¿Qué es?** Un servicio que junta los errores de la app en un tablero, con el stack
trace, el contexto y avisos por mail/Slack. Sin Sentry, un error de plata queda solo en
los logs de Vercel (grepeable por `[PY-ERROR]`, pero hay que ir a buscarlo). Con Sentry,
te llega el aviso y ves exactamente qué falló, cuántas veces y a quién.

**Estado del código:** ya está TODO cableado y testeado. Es **DSN-gated**: sin la clave es
un no-op total (cero impacto, y en el navegador el SDK **ni siquiera entra al bundle**).
Cuando la ponés se activan las dos mitades, **sin tocar código**:
- **Servidor** (`sentry.server.config.ts` + `sentry.edge.config.ts`): puentea `reportarError`
  → los caminos de plata (registrar pago de cobro/panel, cierre de jornada, comisión, gasto,
  movimiento de caja) suben con su tag `contexto`.
- **Navegador** (`instrumentation-client.ts`, Batch 7): carga PEREZOSA del SDK y el mismo
  puente → los límites `error.tsx` de las 3 casas y cualquier acción de plata que falle en
  el celular del cobrador también dejan rastro.
- **CSP**: `next.config.mjs` **deriva solo** el host de ingest desde el DSN y lo agrega a
  `connect-src`. No hay que editar la CSP a mano.

### Paso a paso (10 minutos, una sola vez)
1. **Crear cuenta** en <https://sentry.io> (plan free alcanza de sobra para el piloto).
2. **Crear un proyecto** → plataforma **Next.js**. (No corras su wizard de instalación: ya
   está integrado a mano en el repo. Solo necesitás el DSN.)
3. **Copiar el DSN** que te muestra: una URL tipo
   `https://abc123@o456.ingest.us.sentry.io/789`.
4. **Pegarlo en Vercel** → proyecto Presta Ya → *Settings → Environment Variables*:
   - Nombre: **`NEXT_PUBLIC_SENTRY_DSN`** · Valor: el DSN · Entornos: **Production** y **Preview**.
   - ⚠️ **Una sola variable alcanza para todo.** El server lee
     `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN`, así que con la `NEXT_PUBLIC_` quedan cubiertos
     server + edge + navegador + CSP. (Si ponés solo `SENTRY_DSN`, el navegador y la CSP
     quedan afuera.)
   - El DSN **no es un secreto**: está diseñado para viajar en el navegador y solo permite
     ENVIAR eventos, nunca leerlos. Por eso `NEXT_PUBLIC_` acá es correcto y seguro.
5. **REDEPLOY — obligatorio.** Las `NEXT_PUBLIC_*` se **incrustan en el build**, así que
   guardar la variable no basta: hay que reconstruir. Vercel → *Deployments* → *Redeploy*
   **destildando "use existing build cache"**, o `npx vercel --prod`.
6. **Verificar que tomó** (prueba objetiva, sin provocar errores): pedí los headers de prod
   y mirá que el host de Sentry ahora aparezca en la CSP:
   ```
   curl -sI https://prestaya.uy/ingresar | grep -i content-security-policy
   ```
   En `connect-src` tiene que estar `https://oXXXX.ingest.<region>.sentry.io` además de
   `'self'` y Supabase. Si está, el build tomó la variable y las dos mitades quedaron activas.
7. **Confirmar la llegada:** en el tablero de Sentry (*Issues*) va a aparecer el primer
   error real. El tag `contexto` te dice de qué acción de plata salió.

### Notas
- **Costo:** el plan free tiene tope de eventos/mes; con `tracesSampleRate: 0` solo se
  mandan ERRORES (no trazas de performance), así que se gasta muy poco.
- **Peso en el celular del cobrador:** mientras no haya DSN, el SDK no se incluye (First
  Load JS = 103 kB). Al activarlo, el navegador suma el SDK de Sentry (~30 kB gz) recién
  cuando la variable existe. Es el precio de ver los errores de campo.
- **Alertas:** en Sentry → *Alerts*, creá una regla "cuando aparece un issue nuevo → mail".
  Sin eso hay que entrar a mirar el tablero.
- **Source maps (stack traces legibles):** opcional. Requiere `withSentryConfig` o subir
  los maps en el build. Para el piloto no hace falta; el contexto + el mensaje ya orientan.

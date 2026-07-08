# ESTADO — Empalme Disapp → Presta Ya + Multi-crédito + Escala (handoff quirúrgico)

> Punto de continuación tras compactar. Todo lo de abajo está **en el working tree
> SIN commitear** (44 archivos cambiados). El trabajo se validó contra un **proyecto
> Supabase de PRUEBA**, NO producción.

## ⚠️ CRÍTICO — estado del entorno local
- **`.env.local` apunta al proyecto de PRUEBA** (`nqdrutfxqbuvdvlhtdmb`), NO a prod.
- El `.env.local` de **producción** está respaldado en **`.env.local.PROD.bak`**.
- **ANTES de deploy/commit final:** `cp .env.local.PROD.bak .env.local` (restaurar prod).
- Hay un **dev server corriendo en `http://localhost:3001`** (apuntando a prueba).
- `.env.prueba` (gitignored) tiene URL+service_role de prueba (para los scripts del empalme).

## 🔍 RECONCILIACIÓN vs Disapp (hecha 2026-07-08) — LEER

Carlos comparó el dashboard de Disapp (filtro Activo: **2.417 créditos, Ventas
$88,8M, Con Intereses $96,9M, Recaudo $28,6M**) con nuestro panel y vio menos plata.
**Estudiado a fondo — nuestro panel NO está mal, está más correcto:**

- El Excel fuente (`creditos_*.xlsx`, 2 archivos, unión por ID = **2.748** créditos,
  todos "Activo") suma **$126,1M** de capital.
- **86 de esos créditos son de los 3 SUPERVISORES** (EDWIN/CÉSAR/BOSO): $66,9M
  (53% del capital), **interés ≈0%**, promedio $777k c/u. **Decisión de Carlos:
  es FLOAT MAYORISTA → EXCLUIR** (esa plata ya está contada como los créditos
  chicos de los cobradores de la zona; incluirla = doble conteo). El importador
  YA los saltea (skip por `es_supervisor`). **NO cambiar el importador por esto.**
  ⇒ Disapp DOBLE-CUENTA el float; por eso su dashboard "infla" a $88,8M.
- Nuestro set importado = Excel **menos supervisores** = **2.661 únicos / $59,2M**
  capital / $68,7M con intereses. Es el libro REAL de préstamos a clientes.
- **Multi-crédito es REAL** (no artefacto): 391 clientes (17,9%) con 2+ créditos
  activos distintos (máx 5); 54 clientes con cobradores distintos. Features
  justificadas → se quedan.
- **Pagos:** reconcilian ~92% (84% al peso exacto); las diferencias son casi todas
  DB > Excel por ~1 cuota = timing (recaudos exportados 17:11–19:18, más tarde que
  el snapshot de créditos 16:43). La corrección ×1000 da valores sanos. ✅
- **⚠️ 610 activos DUPLICADOS en PRUEBA** (2.661 filas pero solo 2.051 `disapp_credit_id`
  únicos): artefacto de reimportar ANTES de que existiera el índice único (0036).
  Solo del proyecto de prueba. **El go-live lo elimina** si se corren TODAS las
  migraciones (incl. 0036) ANTES del importador y se importa UNA vez. Verificar
  post-import: `count(distinct disapp_credit_id activos) == count(*) activos`.

**Scripts de reconciliación** (throwaway, ya borrados): cruzaban `.env.prueba` +
`C:\Users\Carlos\migracion\creditos_*.xlsx` por `disapp_credit_id`. Rehacer con
las funciones del importador (`load_clientes`/`load_creditos`/`es_supervisor`)
si hay que re-validar en prod.

## Proyecto de PRUEBA (Supabase)
- Ref: **`nqdrutfxqbuvdvlhtdmb`** · URL `https://nqdrutfxqbuvdvlhtdmb.supabase.co`
- Migraciones corridas ahí: **0001→0040** (esquema completo + empalme + escala).
- Datos importados: **13.028 clientes, 47 cobradores, 11.460 préstamos (2.661 activos +
  8.799 históricos/stubs), 151.327 pagos, 2.242 asignaciones.**
- Logins de validación:
  - Admin: `admin@prestaya.uy` / (contraseña de PRUEBA — ver chat / regenerar)
  - Cobrador con ruta (88 clientes): `cobrador-11879@import.prestaya.local` / (ver `_reportes/credenciales_cobradores.csv`)
  - Cliente multi-crédito: `/c/d80b1f34ed7342bb5f821a3b4436a28abf0cb481d73fd8b6` (MARIA DEL LUJAN CRUZ)
  - Credenciales de los 47 cobradores: `C:\Users\Carlos\migracion\_reportes\credenciales_cobradores.csv`

## Lo que está HECHO y validado (en prueba)
1. **Empalme Disapp→Presta Ya** — `scripts/empalme_disapp.py` (Python + openpyxl).
   - Lee `C:\Users\Carlos\migracion` (xlsx de Disapp). Modos: `--audit`, `--dry-run`,
     `--commit`, `--validate-sample N`. Idempotente. `.env.prueba` por defecto.
   - Decisiones aplicadas: **plata de recaudos corregida ×1000** (Excel se comió el
     separador de miles: float→×1000, int→tal cual); **documento dup → NULL** (1.537);
     **stubs históricos** para créditos huérfanos (8.799); **cobradores con login**
     (email sintético `cobrador-<idVendedor>@import.prestaya.local`); asignaciones
     cobrador↔cliente creadas.
   - Validado: 20 créditos activos, la plata cierra (cuota×días=total, pagado=suma).
   - Gap conocido: **245 pagos sin Ref.Crédito** (0,16%) se descartan (flag para revisión).
2. **Múltiples créditos activos por cliente** (391 clientes) — migración **0037** (levanta
   `un_prestamo_activo_por_cliente`). Data layer: `getPrestamoActivoPorCliente` ya NO usa
   `.maybeSingle()` (devuelve el principal); nuevo `getPrestamosActivosPorCliente`.
3. **Múltiples cobradores activos por cliente** (54 clientes) — migración **0038** (levanta
   `un_cobrador_activo_por_cliente`). `getCobradorDeCliente` ya no crashea.
4. **UI multi-crédito** (todas las superficies):
   - Cobrador: selector de crédito + imputa al elegido (offline-safe, viaja por la cola).
   - Ficha admin: lista todos los créditos activos con su cartón (`getFichaCliente` →
     `activos` plural).
   - Estado de cuenta: por crédito (`?credito=`).
   - Vista cliente `/c/[token]`: selector "Tenés N créditos".
   - Asesor IA: menciona todos los activos.
5. **ESCALA (lo más grande)** — el panel se había hecho para cientos de registros; con
   151k pagos rompía (400 por URL gigante) o mentía (truncado a 1000 filas).
   - **Gotchas descubiertos:** Supabase **corta en 1000 filas** por request; los `.in()`
     de miles de IDs dan **400**; sumar bajo RLS evalúa `app_es_gestor()` **fila por fila**
     → **statement timeout**; funciones SQL simples se **inlinean** e ignoran `set timeout`.
   - **Solución:** RPCs **`SECURITY DEFINER`** (chequean rol UNA vez, saltan RLS por-fila):
     - `0039_sumas_rpc.sql` → `app_suma_pagos_desde/entre`, `app_cuenta_pagos_entre`.
     - `0040_dashboard_rpc.sql` → **`app_cartera_activa()`** (jsonb: 1 fila por crédito
       activo con sus pagos agrupados `[{d,m}]` + nombres) y **`app_serie_recaudo(dias)`**.
       (0040 re-declara las de 0039 como security definer — corré 0040 y quedan bien.)
   - Reescritas para usar las RPCs (fetch chico, **cartón/mora siguen en TS, tested**):
     `metricas.ts`, `mora.ts`, `control.ts`, `cartera.ts`, `series.ts` + helper
     `lib/data/activos.ts` (`getActivosConPagos`/`pagosDeActivo`) + `lib/data/paginado.ts`
     (`traerTodo`, secuencial). `getResumenFinanciero` comparte la RPC entre metricas+mora+control.
   - Resultado: **/admin de 90s (500) → 4.4s (200)**. typecheck+build verdes.
   - ⚠️ **NOTA DE ZONA en 0040:** las RPCs devuelven la operación COMPLETA a cualquier
     gestor (hoy = ok, la única supervisora no tiene zonas). Cuando se configuren zonas,
     hay que filtrar por zona del supervisor dentro de las RPCs (TODO marcado en el SQL).

## Migraciones nuevas de esta tanda (todas corridas en PRUEBA)
`0035` RLS escrituras por zona · `0036` IDs externos Disapp (índices NO parciales, clave
para upsert) · `0037` multi-crédito · `0038` multi-cobrador · `0039` sumas RPC · `0040`
dashboard RPC (security definer). En **PROD** Carlos corrió `0039` y `0040` por error una
vez (son aditivas, inofensivas); el resto de prod está hasta `0033` + `0035`.

## PENDIENTE (en orden)
1. **Carlos está validando** navegando el panel en `localhost:3001` (dashboard/mora/
   cobranza/clientes/caja) + cobrador + cliente. Reportar números raros/lento/roto.
2. **Perf secundaria (si molesta):** el **selector de período Mes/Año** del dashboard
   (`periodo.ts`) y **caja en modo Mes** (`caja.ts`) todavía hacen fetch paginado pesado
   (33k–151k pagos). Convertir a RPC igual que el resto si se usan seguido.
3. **ETAPA 3 — commit + deploy:**
   - `cp .env.local.PROD.bak .env.local` (restaurar prod) + apagar dev :3001.
   - `git add -A` y commitear todo (auditoría senior + empalme + multi-crédito + escala).
   - Deploy a Vercel (prod pública `prestaya-blush.vercel.app`).
4. **ETAPA 4 — go-live PROD (proyecto NUEVO y limpio, decisión de Carlos):**
   - Crear proyecto Supabase prod nuevo → correr `_schema_completo.sql` (regenerar: son
     40 migraciones ahora) → llenar env en Vercel → `python scripts/empalme_disapp.py
     --commit --prod` con `.env` apuntando a prod → `--validate-sample 20` → idempotencia.
   - Rotar claves expuestas (SERVICE_ROLE + DEEPSEEK), VAPID, CRON_SECRET (ver `PENDIENTES.md`).

## Archivos clave
- Importador: `scripts/empalme_disapp.py` · verificador esquema: `scripts/check-esquema-prueba.mjs`
- Mapeo/decisiones: `docs/mapeo-empalme.md` · plan original: `empalme-disapp-claude-code.md`
- Escala: `lib/data/{activos,paginado,metricas,mora,control,cartera,series}.ts` +
  `supabase/migrations/{0039,0040}*.sql`
- Multi-crédito: `lib/data/prestamos.ts` (getPrestamosActivosPorCliente), `lib/data/ficha.ts`,
  `app/cobrador/(app)/{actions.ts,cliente/[id]/page.tsx}`, `components/cobrador/RegistroCobro.tsx`,
  `lib/cobrador/{colaOffline,useSync}.ts`, `app/c/[token]/page.tsx`, `components/VistaClienteScreen.tsx`,
  `app/admin/(panel)/clientes/[id]/{page.tsx,estado/page.tsx}`
- Datos fuente Disapp: `C:\Users\Carlos\migracion` (xlsx). Reportes: `…\migracion\_reportes\`

## Reglas de trabajo con Carlos
- Correr DDL: **solo Carlos**, en el SQL Editor (yo genero el .sql y lo dejo en el Escritorio).
- Verificar en vivo reproduciendo con sesión real (script `_repro.mjs` temporal: login por
  `@supabase/ssr` → cookie → fetch a localhost, leer error del dev log).
- No commitear sin que Carlos lo pida. `.env*` gitignored (nunca subir secretos).

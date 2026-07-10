# ESTADO — Empalme Disapp → Presta Ya + Multi-crédito + Escala (handoff quirúrgico)

## 🔴🔴 CONTINUAR ACÁ (sesión 2026-07-08, la más reciente) 🔴🔴

**✅ RECONSTRUCCIÓN DE PAGOS NO-DIARIOS: HECHA Y APLICADA A PRUEBA.**
`scripts/empalme_disapp.py` paso [6] implementado + `--commit` corrido en
`prestaya-pruebas`. Detalle en `docs/reconstruccion-pagos-no-diarios.md`.
- **251 créditos reconstruidos · 3.582 pagos de ajuste (`origen='ajuste_migracion'`,
  `registrado_por=NULL`) · $13,89M · 🔴 sub-cobrados (falta plata) = 0.**
- **Capital en calle: $107,7M → $93,88M.** 🔴🔴 **CORRECCIÓN (2026-07-10):** la
  afirmación "$93,88M = libro completo real; el $68,5M de Disapp esconde cartera" es
  **ERRÓNEA**. El PDF autoritativo "Cartera por Cliente" de Disapp da **$68,54M / 2.413
  créditos** exacto. El gap de **$25,76M / 341 créditos** son **REFINANCIACIONES a 0%
  doble-contadas** (crédito nuevo "Activo" sin cerrar el viejo en el export). El número
  CORRECTO es $68,5M; nuestro $93,88M infla. Regla que lo cuadra al 0,75%: quedarse con
  el crédito MÁS NUEVO por (cliente, modalidad). Ver `memory/refinanciacion-cuadre.md`.
- Idempotente (re-POST de 151.572 import quedó en 151.572; ajustes deterministas
  `ajuste-<credit>-<dia>`). Base LIMPIA: 2.747 activos + 8.799 finalizados = 11.546
  SIN duplicados (el viejo warning "610 duplicados" YA NO aplica).
- Hallazgos verificados: `Pagos+Saldo==Total` 100% pero `Cuotas Pend.` solo 25,6%
  fiable→informativa; los recaudos también omiten pagos DIARIOS viejos (fuera de la
  ventana del export). Nuevos: `--probe`, gap en `--audit`, CSV de revisión, y
  `get_rows()` del importer con `order=id` (mismo bug de paginación).

**⚠️ 0041 CAMBIÓ (Bloques 3-7 estéticos):** ahora además agrega la RPC
`app_recaudos_rango` (página Recaudos) y `usuarios.documento`. **RE-CORRER 0041 en
el SQL Editor** (test DB) para que funcione /admin/recaudos. Sigue re-ejecutable.

**Bloques 3-7 (acople estético/UI) HECHOS (tsc + 237 tests verdes):** Recaudos
(`/admin/recaudos`), Caja diaria nutrida (cuenta operativa + Visible + rango + cats
Disapp), Inversión de capital (`/admin/capital`), Equipo estilo Disapp + modal Detalle,
Clientes lista enriquecida + toggle Reportado en ficha + Género/Ciudad/Dir.secundaria,
Informe de cartera (`/admin/informe-cartera`). Todo SIN commitear.

**PRÓXIMO PASO:** re-correr 0041 → validar navegando la PRUEBA (dashboard: Capital en
calle ~$93,9M, mora mucho menor) → commit de TODO lo sin-commitear → go-live a PROD
nuevo y limpio (40 migs + `--commit --prod` + rotar claves). Plan de reconstrucción abajo.

**Entorno REAL ahora (ignorar la sección "CRÍTICO" de abajo, quedó vieja):**
- Base de PRUEBA en uso: **`prestaya-pruebas`** = ref **`kvmqlkqfgjimfpzlwsdt`**.
  `.env.local` Y `.env.prueba` apuntan ahí. (El viejo `nqdrutfxqbuvdvlhtdmb` quedó
  obsoleto; el prod real sigue respaldado en `.env.local.PROD.bak`.)
- **Dev server en `http://localhost:3000`** (no 3001).
- Import limpio corrido ahí: 13.028 clientes · 2.747 activos · 8.799 stubs ·
  151.572 pagos. Migración **0041 corrida** en ese proyecto.
- Logins de prueba: admin `admin@prestaya.uy` / `PrestaYa2026!` · cobrador ruta
  `cobrador-8138@import.prestaya.local` / `JaXtZpqbPKcv` · CARTERA VIP
  `cobrador-13519@import.prestaya.local` / `dRfd2VDFyGm9` · cliente
  `/c/c6c556e8c04f89c8e8d70dbce8d3147c486091ca2e20be4a` (LAURA DA ROSA).

**EL problema a resolver (verificado):** la exportación de recaudos de Disapp es
"Recaudos Diario" → solo pagos DIARIOS. Los pagos de créditos SEMANALES/quincenales/
mensuales/VIP **no se pueden exportar** (Disapp no lo permite). ⇒ 40% de créditos
semanales ($33,4M) figuran con $0 pagado → inflan mora y cartera. **Decisión de
Carlos: reconstruir** el pagado desde la columna `Pagos` del Excel de créditos
(sembrar un pago de ajuste `origen='ajuste_migracion'` por la diferencia). Detalle
en el doc citado.

**Conciliación mío vs Disapp (tras la reconstrucción):**
| Métrica | Mío (antes) | Mío (AHORA) | Disapp | Nota |
|---|---|---|---|---|
| Total de clientes | 13.027 | 13.027 | 13.032 | ✅ ~cuadra |
| Total de ventas activas | 2.747 | 2.747 | 2.419 | Disapp filtra/esconde parte de su cartera |
| Capital en calle | $107,7M | **$93,88M** | $68,5M | mío = libro COMPLETO real (= Σ Saldo Disapp $94,17M) |
| Ventas en mora (conteo) | 1.958 | ↓ (validar en UI) | 532 | los no-diarios/diarios-viejos dejan de figurar impagos |

**Código de ESTA sesión (todo SIN commitear, tsc + 237 tests VERDES):**
- `lib/cartones.ts` → cartón **FIFO acumulado** (arregla el bug de "Cuota #" de Disapp,
  que era un snapshot inútil). `lib/vistaCliente.ts` → comprobante FIFO.
- `lib/data/metricas.ts` → mora con **gracia = config_mora.cuotasGracia + 1** (día de
  desembolso); + `porCobrarHoy` + `deudoresActivos`.
- Fix de **paginación** (`.order("id")`) en periodo/caja/control/exportacion/paginado
  (sin orden estable PostgREST repite/saltea filas → plata mal). Bug de dinero.
- `supabase/migrations/0041_disapp_parity.sql` (movimientos_caja cuenta/visible ·
  clientes reportado/genero/ciudad/direccion_secundaria · prestamos
  es_float_supervisor/interes_pct). `types/db.ts` + mappers actualizados.
- Dashboard: **6 tarjetas alineadas a Disapp** + copy arreglado ("Total de clientes"
  sub = "X con crédito activo", ya NO "clientes activos") + tabla **Liquidación diaria**
  (`lib/data/liquidacion.ts` + test).

**Regla que Carlos remarcó:** VERIFICAR contra la data real, no deducir (ver
`memory/verificar-no-deducir.md`).

---

> (Lo de abajo es de sesiones previas; parte del entorno quedó viejo — usar el bloque
> de arriba.) Todo el trabajo está **en el working tree SIN commitear**.

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
- **86 de esos créditos son de los 3 SUPERVISORES** (EDWIN/CÉSAR/BOSO): $66,9M,
  **modalidad SEMANAL/quincenal, interés 0%, montos altos** ($0,8–1,75M). Al ver
  la "Cartera por Cliente" de Disapp se confirmó que son **CLIENTES REALES**
  (nombre/doc/tel), cartera VIP que el supervisor gestiona en persona (NO tienen
  ruta diaria). **Decisión de Carlos (revisada 2026-07-08): IMPORTARLOS** — es
  $47,9M de saldo real por cobrar. Se traen como un **cobrador dedicado
  "CARTERA \<zona\>"** por supervisor (opción elegida). Importador YA modificado:
  paso [1] crea `CARTERA ZONA SUR/CENTRO/…` como rol cobrador; paso [3] ya NO
  saltea (`inc_cartera=86`). Dry-run confirma **2.748 créditos**.
  ⚠️ (Mi lectura inicial de "float mayorista, excluir" fue ERRÓNEA — no repetir.)
- Con supervisores, cartera total real = **2.748 / $126,1M** capital / $135,6M con
  intereses / saldo $94,2M. Es MÁS que el dashboard de Disapp ($88,8M): Disapp
  esconde parte de su propia cartera con su filtro interno. El nuestro es el libro
  completo y real.
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

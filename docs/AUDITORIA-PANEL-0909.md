# Auditoría del panel — informe para Carlos
**Fecha:** 09-09-2026 · **Alcance:** 44 pantallas de admin/supervisor, `lib/data/**`, `lib/acciones/**`
**Método:** cada hallazgo pasó por tres refutadores independientes que leyeron el código y midieron contra la base viva. Abajo va lo que sobrevivió, agrupado por causa raíz, con las magnitudes corregidas y los arreglos que **no** rompen otra cosa.

Ojo con una cosa antes de empezar: varios de los arreglos que los agentes proponían estaban mal y hubieran hecho más daño que el bug. Están todos en la sección **NO HACER** al final. Leela antes de tocar nada.

---

## 1. La migración 0096 nunca corrió: nueve tablas siguen con las policies anchas que ella venía a cerrar

**Qué pasa.** Hay una migración de endurecimiento de RLS escrita el 15-08 que **nunca se aplicó a la base**, porque su primera sentencia es `drop policy if exists recibos_select on recibos` y la tabla `recibos` no existe. El `if exists` protege la policy, no la tabla: el archivo aborta en la línea 19 con `42P01` y el SQL Editor, que corre todo en una transacción, revierte el resto. Nadie se enteró porque el vigilante de policies compara contra un snapshot regenerado *desde la base viva*, o sea que bendijo el estado sin 0096.

**A quién le pega.** A vos. Es control interno: lo que un supervisor puede leer y escribir por REST crudo, saltándose la pantalla.

**Números (medidos en `pg_policies` de la base viva, hoy).**

| Tabla | Policy viva | Qué habilita |
|---|---|---|
| `auditoria` | `audit_select` = `app_es_gestor()` | Los 3 supervisores activos leen las **1.510 filas** del log completo, de todas las zonas — incluidas las 948 que hiciste vos: comisión fijada en 3,5 %, "Liquidó comisión — MARIA ARTUNDUAGA $2.807", bases de caja con nombre y monto, gastos aprobados |
| `mora_notas` | `mora_notas_write` = `for all` con `app_es_gestor()` | Un supervisor **inserta, edita y BORRA** notas de mora de clientes de cualquier zona. Destructivo, y son PII (motivos de atraso, acuerdos) |
| `config_scoring`, `config_mora`, `config_operacion` | `*_write` = `app_es_gestor()` | Un supervisor PATCHea por REST el **tope de usura** y los pesos del score, salteando el gate de admin de la app |
| `reconciliacion_log` | `using (true)` | Lo lee **cualquiera de los 52 cobradores** |
| `estrellas_redenciones`, `solicitudes_producto`, `snapshot_credito`, `snapshot_totales` | pre-0096 | lectura ancha |

Lo único que hoy coincide con 0096 es `solicitudes_renovacion`, y viene de la 0140, no de 0096.

**Archivos.** `supabase/migrations/0096_rls_hardening_tablas.sql` (línea 19, el bloque de `recibos`), `scripts/policies-esperadas.json`, `scripts/tablero-qa.mjs:448`.

**Arreglo.** Una migración nueva (0160) que reaplique 0096 con dos cambios:
1. El bloque de `recibos` envuelto en `do $$ begin if to_regclass('public.recibos') is not null then ... end if; end $$;`
2. `audit_select` escrita **inline**, sin funciones `SECURITY DEFINER` que reciban la fila (es el anti-patrón que mató la 0159), y con la rama que 0096 se olvidó: el propio actor. Sin ella, "Mi jornada" del supervisor pierde su bitácora del día (Mauricio tiene 36 filas propias), porque los supervisores tienen `usuarios.zona_id = NULL` y su zona vive en `supervisor_zonas`:

```sql
drop policy if exists audit_select on auditoria;
create policy audit_select on auditoria for select to authenticated
  using (
    (select app_es_admin())
    or actor_id = (select app_usuario_id())
    or actor_id in (
      select u.id from usuarios u
      where u.zona_id in (select sz.zona_id from supervisor_zonas sz
                          where sz.supervisor_id = (select app_usuario_id()))
    )
  );
```
3. Aplicarla con el patrón de `scripts/aplicar-0159-rls.py`: foto de qué ve cada usuario activo ANTES, aplicar, foto DESPUÉS, `ROLLBACK` si se mueve algo que no se quiere mover. Verificación esperada: César y Edwin pasan de 1.510 a 0 filas de auditoría, Mauricio de 1.510 a ~517, el admin sigue en 1.510, cobradores en 0.
4. Y el arreglo de fondo: que `tablero-qa.mjs` compare las policies vivas contra lo que declaran los **archivos** de `supabase/migrations/**`, no contra el snapshot. Si no, la próxima migración que no corra vuelve a pasar 25 días sin que nadie lo note.

**Aparte:** `/admin/recibos` está en el menú del admin y ofrece el botón de emitir sobre una tabla que no existe. Es la misma causa. Sacarlo del menú o crear la tabla.

---

## 2. El capital que el cobrador prestó hoy no se resta: la app le reclama plata que ya está trabajando

**Qué pasa.** Cuando el cobrador coloca capital en la calle, esa plata sale del efectivo que tiene en el bolsillo. La fórmula correcta es `base + recaudado − gastos − colocado`, y así está en cinco lugares. Falta en uno — el Centro de alertas — y los textos que le explican la cuenta al dueño quedaron con la fórmula vieja.

**A quién le pega.** A vos y al supervisor: es la pantalla donde se decide a quién apretar. Y al cobrador, que aparece acusado con nombre y apellido.

**Números.**
- `centroAlertas.ts:98` arma el título `"{nombre} recaudó {UYU(p.recaudado)} y aún no rindió"` con el bruto. `p.colocado` está ahí, en el mismo objeto, y no se usa. El caso que el propio repo dejó documentado: **Fernando Castro, $235.738 mostrados cuando tenía $76.738 en la mano** — los otros $159.000 estaban colocados en 7 renovaciones.
- En **la misma pantalla**, `jornada/page.tsx:847` muestra el neto ("$X en la calle") y `:982` el título bruto. Dos cifras de la misma persona, en el mismo minuto.
- La capa de datos lo pide explícito: `rendicion.ts:673-675` — *"el capital colocado viaja aparte para que cada pantalla reste y pueda MOSTRAR la resta"*.
- Los textos: **3 de las 4 actas de todo el piloto** tienen `colocado > 0` ($139.000, $50.000, $10.000 = **$199.000**). En las tres la pantalla dice "Cuadra ✓" con diferencia $0, mientras el texto que está arriba manda calcular un faltante de $139.000 que no existe.

**Archivos.** `lib/data/centroAlertas.ts:92-104` · `lib/data/vigilancia.ts:272-278` (el Mini "Sin rendir" de `/admin/alertas`, también bruto) · textos: `app/admin/(panel)/caja/page.tsx:142` y `:227`, `app/admin/(panel)/cierre/page.tsx:113` y `:177`, comentario `lib/cierreZona.ts:8-9`.

**Arreglo.**
```ts
// centroAlertas.ts, bloque 2)
const enMano = Math.max(0, Math.round(p.recaudado) - Math.round(p.colocado));
titulo: p.colocado > 0
  ? `${p.nombre} tiene ${UYU(enMano)} en mano y aún no rindió`
  : `${p.nombre} recaudó ${UYU(p.recaudado)} y aún no rindió`,
detalle: p.colocado > 0
  ? `Recaudó ${UYU(p.recaudado)} en ${p.cobros} cobro(s) y colocó ${UYU(p.colocado)} en la calle. Sin cierre de jornada.`
  : `${p.cobros} cobro(s) hoy sin cierre de jornada.`,
```
La guarda `if (p.recaudado <= 0) continue` y la dedup de float alto se dejan **sobre el bruto** (si colocó todo lo que cobró, la jornada sigue abierta y la alerta debe existir).

Los textos, con la fórmula correcta **por superficie** (esto es clave, no son iguales):
- **Acta del cobrador** (`caja:142`, `cierre:113`, `cierre:177`): `esperado = base + recaudado − gastos − el capital que colocó en la calle`. El **retenido NO va acá**: entra del lado del entregado (`rendicion.ts:72`, `diferencia = entregado + retenido − esperado`).
- **Total de la zona** (`caja:227`, que apunta a "Cierre por zona"): ahí SÍ se resta el retenido (`cierreZona.ts:188`).

Y `cierre/page.tsx:113` hoy se come también la `base`, no solo el colocado.

---

## 3. Pantallas que no dicen de qué universo hablan: espejo de Disapp vs. trabajo de la app

**Qué pasa.** El 97 % de los pagos de la base son el espejo de Disapp, fechados con la fecha real del cobro. Algunas pantallas los suman como si fueran plata que entró por la app; otras los filtran (bien) pero no lo dicen, y entonces afirman "no pasó nada" sobre días de $1,7M. La regla del ORIGEN se aplicó a medias.

**A quién le pega.** A vos. Todas son pantallas del dueño.

**Números.**

| Pantalla | Qué muestra | Qué es en realidad |
|---|---|---|
| `/admin/caja` | 02-09: "Total Entradas **$1.728.164**" y 40+ cobradores en "Recaudado por cobrador" | Nativo del día: **$38.470** (41 pagos). El resto son 1.315 asientos de Disapp. **44,9×**. El 05-09 muestra $1.714.604 con **0 cobros de la app**, y el bloque "Cierre por zona" de la misma pantalla queda vacío |
| `/admin/valor` | "Cobranza gestionada este mes **$7.955.632**" y "**2 %** auditable · GPS + hora" | Del mes: 6.004 pagos importados ($7.687.538) y 141 nativos ($268.090). Los 141 nativos tienen GPS **141/141 = 100 %**. La pantalla que te justifica la inversión subestima la trazabilidad **43×** y te atribuye $7,69M que la app nunca tocó |
| `/admin/estadisticas` "Recaudo por mes" | feb-26: **$17.683.320** en 10.133 cobros | Cobranza real: **$8.293.905** (9.549). Arriba se le suman 584 asientos `ajuste_migracion` por $9.389.415. Jul +$2.375.603, ago +$1.312.017. **$14.756.807** repartidos en las 8 barras. Y el chip "Recaudado (mes)" muestra +9,7 % de crecimiento cuando el real fue +12,9 % |
| `/admin/movimientos` | 05-09: "**Sin pagos registrados ese día**", "Pagos (0) · Recaudado $0" | Recaudos, con el mismo rango y a un clic, lista **1.134 pagos por $1.714.604**. 268 de los 301 días con pagos tienen 0 nativos |
| `/admin/comisiones` | ~47 filas diciendo "recaudó $0 · 0 cobros · ticket $0" | El filtro `origen is null` es correcto (0127: la comisión de Disapp ya se pagó allá). Lo que falta es decirlo: hoy la pantalla de PAGO acusa en silencio a 47 personas que cobraron todos los días |

**Archivos.** `lib/data/caja.ts:118-129` · `lib/data/valor.ts:83-84` + `0052_cobros_mes_rpc.sql:12-13` + `valor.ts:34-48` (el fallback también) · `0086_stats_mensual_acotado.sql:32` · `app/admin/(panel)/movimientos/page.tsx:139-140, 199, 201, 205` · `components/admin/TablaComisiones.tsx:109` + `app/admin/(panel)/comisiones/page.tsx:128, 168, 183, 245`.

**Arreglo.**
1. **Caja:** agregar `.is("origen", null)` en `resumenCajaCore`. Corrige de arrastre `/admin/cierre` y el CSV. Como el 04, 05 y 06-09 pasan a mostrar $0, que la pantalla diga "0 cobros en la app en este rango" en vez de una tarjeta vacía. Si querés seguir viendo el espejo, va como KPI **aparte y rotulado**, nunca dentro de "Total Entradas" ni del "Balance operativo" (los egresos ya son 100 % nativos: la asimetría infla el balance).
2. **Valor:** `and origen is null` en las dos ramas de `app_cobros_mes` (migración nueva, no editar 0052) **y en el fallback `contarPagosMes`**, o el primer error de RPC vuelve a publicar el 2 %. Partir el héroe en dos: "Cobrado por la app este mes $268.090 · 100 % auditable (141 de 141)" y, en gris, "Entró al negocio $7.955.632 (incluye $7.687.538 de Disapp, sin GPS)". **No** tocar `app_suma_pagos_desde`: la comparte el dashboard.
3. **Estadísticas:** migración nueva con `and (origen is null or origen = 'disapp_import')` en el CTE `recaud` de `app_stats_mensual` — con el `or` explícito, nunca `<>` (los NULL de los nativos se caerían). Avisar antes: feb-26 se derrumba de $17,7M a $8,3M y va a parecer que se rompió algo.
4. **Movimientos y Comisiones:** puro rótulo. "Pagos registrados en la app", "Recaudado en la app", "Sin pagos registrados EN LA APP ese día — los cobros espejados de Disapp se ven en Recaudos", "recaudó por la app $X". En comisiones, el pie: *"…los cobros importados de Disapp no cuentan acá: ya se comisionaron allá. Un cobrador que trabajó en la calle sin usar la app aparece en $0"*.

---

## 4. El score de confianza premia no usar la app

**Qué pasa.** El puntaje arranca en 100 y solo resta. Quien no dejó ninguna huella sale 100 = "Intachable" en verde. Y la penalización más pesada (−12 por día, techo −40) mide "no hay fila en `rendiciones`", o sea "no cerró el acta en la app" — con 4 actas en todo el piloto, eso le pega a todo el que trabajó.

**A quién le pega.** A vos (la pantalla anti-fuga está invertida) y al cobrador que sí adoptó.

**Números (base viva, ventana 30 días).**
- 52 cobradores activos. **36 sin un solo cobro por la app → 100 puntos, "Intachable" en verde.** Entre ellos hay cuentas como "Cartera Zona Centro", "Cartera Zona Sur" y "Administrador Presta Ya".
- Los **16 que sí usaron la app**: 11 en riesgo, 3 en observar, 2 confiables. Siete puntúan literalmente **0**.
- El bloque destacado (lo primero que ves) tiene 14 filas y **las 14 tienen actividad**: es exactamente la lista de los que adoptaron.
- **María Artunduaga** — 21 días activos, la que más usó la app en toda la empresa — puntaje **0**, banda RIESGO, "21 día(s) recaudó y no rindió", "Sin rendir **$1.627.640**" en rojo.
- `rendiciones`: 4 filas en todo el piloto, **1 sola** en los últimos 30 días.
- `diasActivos` está declarado en `scoreCobrador.ts:15` con el comentario "Contexto, no penaliza" y **nunca se lee**.

**Archivos.** `lib/scoreCobrador.ts:74-139` · `lib/data/vigilancia.ts:272-278, 281, 309` · `app/admin/(panel)/alertas/page.tsx:27, 58, 111, 192-212`.

**Arreglo.**
1. **Banda `sin_datos`** cuando no hay NINGUNA señal — no solo `diasActivos === 0`. Si mirás solo pagos y rendiciones, tapás al que tiene 0 cobros pero 3 días "planchado" en la bitácora, que es justo el patrón que la pantalla busca:
```ts
const hayEvidencia = s.diasActivos > 0 || s.rendiciones > 0 || s.cobros > 0 || s.noPagos > 0
  || s.faltantes > 0 || s.diasAlerta > 0 || s.diasObservar > 0 || s.fueraDeZona > 0 || s.sinGps > 0;
if (!hayEvidencia) return { banda: "sin_datos", motivos: ["Sin actividad en la app en la ventana: no hay nada que medir"], ... };
```
   En la pantalla: círculo **gris** con "—", no verde con 100. Fuera del ranking y del bloque destacado.
2. **Separar "no cerró el acta" de "no entregó la plata".** La señal de fuga real ya existe y está bien: `faltantes` (`diferencia < 0` en un acta que SÍ se hizo). `diasSinRendir` no debe penalizar si el cobrador **no tiene ninguna rendición en la ventana** — sin acta previa no hay declaración contra la cual medir. Con 1 acta en 30 días, ese −40 está midiendo adopción, no custodia.
3. **Rótulos:** "N día(s) recaudó y no rindió" → "N día(s) sin cerrar la caja en la app"; el Mini "Sin rendir" en rojo se reserva para `diferenciaAcumulada < 0`. Y el subtítulo: "Últimos 30 días, sobre lo cobrado EN la app. Quien no cobró por la app no se puede evaluar."
4. **Test que falta:** todo en cero → NO "intachable"; todo en cero + `diasAlerta: 2` → sí puntúa. El fixture actual (`diasActivos: 20, rendiciones: 20`) nunca probó el caso que hoy es el 69 % de las filas.

---

## 5. La caja: el cartel verde contradice al rojo, y el backlog de actas se evapora solo

**Qué pasa.** Tres defectos del mismo origen: los rótulos del cierre afirman sobre TODO lo que solo midieron de HOY, y la lista de jornadas sin acta tiene una ventana de 30 días que nadie declara.

**A quién le pega.** Al supervisor y a vos.

**Números.**
- **"La caja está limpia: sin faltantes ni float en la calle"** (escudo verde) sale cuando `faltantes === 0 && sinRendir === 0`, y esos dos miden **solo hoy**. Con 4 actas en todo el piloto, ese es el estado por defecto. Medido hoy: la tarjeta roja de arriba dice "16 cobradores no cerraron su caja · 112 jornadas · **$5.431.417** sin acta" y el escudo verde de abajo, en el mismo scroll, dice que no hay float. Y las bases entregadas esta mañana tampoco cuentan.
- **Acto 3, día sin actividad:** "0 rindieron · **todos entregaron**". De los últimos 22 días, 6 tuvieron cero cobros nativos; los 6 cobradores con actividad en 21 días son todos de Zona Centro, así que un supervisor de otra zona ve esa frase todas las noches.
- **La ventana de 30 días.** `getJornadasSinRendir(..., 30)` recorta las tres fuentes. Total real: **154 jornadas abiertas**, del 10-07 al 08-09. El panel lista **111** ($2.305.347). Las otras **43 — 19 cobradores, $3.244.915, el 58 % de la plata sin sello** — no aparecen en ninguna pantalla. Y el cartel "la más vieja hace {N} días" **topea en 30 por construcción**, cuando la más vieja tiene 61.

**Archivos.** `app/admin/(panel)/jornada/page.tsx:760, 853, 1084, 239, 517-527` · `lib/data/rendicion.ts:279, 285, 299, 333, 357` · `components/admin/JornadasSinRendir.tsx:40-47` · `lib/data/piloto.ts:189` (usa 14 días, tapa aún más).

**Arreglo.**
1. Pasarle a `<Apertura>` el `jornadasAbiertas.length` y el monto, y **no mostrar el escudo verde** cuando hay plata vieja sin acta. Si no hay nada de hoy ni de antes: "Hoy todavía nadie rindió, y no quedan cajas de días anteriores sin acta". Nunca "sin float en la calle".
2. Acto 3, una línea: `c.rendidos === 0 && c.pendientes === 0 ? "Nadie registró cobros hoy: no hay caja que cuadrar" : ...`
3. **Separar la ventana de LECTURA de la de ESCRITURA.** El tope de 30 días para *sellar* queda como está (mueve comisiones ya liquidadas — es tu regla). Pero la lista debe mostrar el backlog completo, con las de más de 30 días en un bloque de **solo lectura**, sin botón, con el texto que la propia acción ya devuelve: *"Ya no se sella como acta: si recibiste ese efectivo, registralo en Caja como ingreso con la fecha en la nota"*, y link a Caja. Más un aviso a los 25 días ("le quedan N días para sellarse").
4. `diasSinCerrar` calculado sobre el conjunto completo, y el cartel partido: "$5.550.262 sin acta · $2.305.347 todavía sellables · $3.244.915 anteriores al 10-08, solo por Caja".

---

## 6. Consultas que cortan en silencio y pantallas que no lo declaran

**Qué pasa.** `.limit(N)` con N > 1000 no hace nada: PostgREST corta en 1000 y devuelve 206 sin error. Y hay listas que se recortan en pantalla sin decir de cuántas. El repo tiene el helper (`traerTodo`) y la regla escrita ("esto es DINERO"), pero quedaron seis lugares sin aplicarla.

**A quién le pega.** A vos, en la pantalla donde juzgás al equipo.

**Números.**

| Dónde | Qué corta | Consecuencia medida |
|---|---|---|
| `/admin/auditoria` — `actividad.ts:79`, `CAP = 500` **por fuente** | 30 días: 3.195 pagos nativos → llegan **492** | Se muestran **$992.170 de $4.909.071** (20 %). **12 de los 16 cobradores que cobraron figuran con CERO**: La negrita $387.663 → 0, TOÑO $359.639 → 0, Londoño $228.500 → 0, María Curbelo $161.860 → 0, Yuli Toro $182.965 → 0. Los días 11 al 22 de agosto aparecen mostrando solo "↩️ Deshizo un cobro" — el 11-08, 8 eventos, ninguno un cobro, en un día de $930.679 |
| idem — `auditoria/page.tsx:75`, tope 600 + botón | Con "30 días · Todo" (1.310 hechos) | El botón "Mostrar más movimientos" queda **muerto** a partir del quinto clic; y con el filtro "Cobros" `hayMas` da **false** con 543 de 2.939: la pantalla se declara completa |
| `/admin/uso` — `uso.ts:212`, `.limit(20000)` sobre `auditoria` | 30 días: 1.285 filas → llegan **1.000** | Muerde HOY. Se pierden las más viejas: Mauricio Rengifo muestra **10 acciones de 22** (−71 %); un admin muestra **0 de 12** y el chip desaparece |
| `/admin/caja` — `caja.ts:243`, `slice(0, 150)` | 02-09: el libro tiene **1.356 líneas**, se ven 150 | Los KPI de arriba suman las 1.356. El título dice "Libro de caja" a secas |
| Ficha del cliente — `ficha.ts:164`, `slice(0, 100)` | **904 clientes** tienen más de 100 pagos (máx. 1.077), 829 con crédito activo | Sin ningún rótulo. Y es la única pantalla con el botón Anular |
| `/admin/operacion` — 4 × `traerTodo` sin `.order("id")` | 2.865 créditos + 2.801 asignaciones = 3 páginas c/u | Riesgo latente de repetir/saltear filas en "Por cobrar" y "Clientes". Hoy medí 0 duplicados en 6 corridas, pero es la regla que el propio `paginado.ts:18` llama OBLIGATORIA |
| Tienda — `ganancias.ts:90/110`, `proyeccion.ts:27/28` | Latente (0 ventas de tienda) | **Bonus real:** `proyeccion.ts:28` pide `prestamos.monto`, columna que **no existe** → HTTP 400 tragado dentro del `Promise.all` → `ingresoReal` = $0 para siempre, mudo |
| `actividad.ts:357`, `.limit(2000)` | Latente (pico histórico 465/día) | — |

**Arreglo.** Reemplazar cada `.limit(N)` por `traerTodo` con `.order("id", { ascending: true }).range(d, h)`, y agregar `.order("id")` a las cuatro de `operacion.ts`. En auditoría, además: paginar las fuentes de plata por rango, y que `getActividad` devuelva **qué fuentes tocaron el tope** para pintar el aviso aunque `hayMas` sea false. En caja y en la ficha: rotular el corte ("las últimas 150 de 1.356", "los 100 más recientes de 1.077 — los totales de abajo suman todo") con link a la pantalla que sí lista completo. En `proyeccion.ts`: la columna es `monto_prestado`, y dejar de tragarse el `.error`.

**Y el guardián que evita la próxima vez:** un test que lea el **código fuente** de `lib/data/**` y falle si un callback de `traerTodo` llega a `.range(` sin `.order(` antes, o si aparece `.limit(N)` con N > 1000. Este mismo defecto ya se arregló una vez en `operacion.ts` y sobrevivió en las otras cuatro llamadas del mismo archivo.

---

## 7. "Cuota diaria" y "Días atraso" sobre créditos que no son diarios

**Qué pasa.** Es el error más caro y repetido del proyecto, y quedaron tres pantallas sin corregir. El cartón cuenta **cuotas**; en un semanal cada casilla es una semana.

**A quién le pega.** A vos y al supervisor, en la ficha con la que se decide renovar, cobrar o anular.

**Números.** 741 activos no diarios (678 semanales, 47 quincenales, 16 mensuales) = **$52,9M de los $86,2M** de deuda viva (62,7 % del capital). Caso real medido: crédito semanal `0241785c`, el chip dice "**10 días** sin cubrir" cuando son 10 semanas, y el chip de al lado, en el mismo renglón, dice "68 días sin pagar". Dos números contradictorios pegados, y el que subestima 7× es el que define la prioridad de visita.

**Archivos.** `app/admin/(panel)/clientes/[id]/page.tsx:342` ("Cuota diaria"), `:350` ("Días atraso"), `:358` ("X/Y días") · `components/admin/FichaRapida.tsx:126, 136` · `app/admin/(panel)/mora/page.tsx:264` · `lib/data/ficha.ts:70-89` (`CreditoActivoFicha` no expone `frecuencia`, aunque la fila ya viene del `select("*")`).

**Arreglo.**
1. Agregar `frecuencia: FrecuenciaPrestamo` a `CreditoActivoFicha` y poblarla con el default `"diario"` para las filas viejas.
2. `ROTULO_CUOTA[activo.frecuencia]` en vez de "Cuota diaria"; **"Cuotas atrasadas"** (la misma palabra que ya usa `/estado`, para que las dos pantallas del panel no se contradigan); "X/Y **cuotas**".
3. Mora: `${s.rachaAtraso} cuotas seguidas sin cubrir` — el string que `lib/alerta.ts:165` ya genera. NO tocar el chip vecino (`diasSinPagar` sí son días de calendario).
4. El guardián (`lib/domain/rotulos.test.ts`) solo mira 3 pantallas y su patrón es plural ("Días atrasados"), así que ni siquiera cazaría "Días atraso". Sumar `clientes/[id]/page.tsx`, `FichaRapida.tsx` y `mora/page.tsx` al array, y ampliar el patrón a `/(label|k)=["']Días atrasad?os?["']/` más uno para `rachaAtraso}\s*días`.
5. Corregir de paso el JSDoc de `types/alerta.ts:19, 25, 27`, que documenta estos campos como "días" — es de ahí de donde se copió el error.

---

## 8. "Finalizado" no es "saldado": 962 créditos con deuda salen en verde con "Pagado ✓"

**Qué pasa.** El historial del cliente pinta de verde y cuenta como "pagados" a todo lo que no está activo.

**A quién le pega.** Al cobrador parado en la puerta decidiendo si le presta de vuelta, y a vos.

**Números.** `HistorialCreditos.tsx:55`: `pagados = creditos.filter(c => c.estado !== "activo").length`. Medido: **962 finalizados con $8.328.498 sin cubrir** (el badge verde), más 271 de 333 refinanciados y 15 cancelados = **1.248 créditos** contados como pagados sobre 13.240 no-activos. `lib/data/ficha.ts:257-264` ya tiene el comentario que dice que esto está mal y ya calcula `seCubrio` — pero solo lo usa para apagar la insignia "👌 Pagó en N días". El badge y el contador quedaron con el predicado viejo. Mismo defecto en el dashboard: `page.tsx:388` rotula el tile "créditos **saldados**" y cuenta cerrados (69 de los últimos 30 días cerraron debiendo $504.787).

**Arreglo.** Exponer `seCubrio` en `CreditoFicha` (ya está calculado). Contar `estado === "finalizado" && seCubrio`. Badge: verde solo para los saldados. **Para los 962 que no cubrieron, usar un rótulo NEUTRO en gris ("Cerrado"), no ámbar acusatorio** — los 962 son 100 % importados (521 del import de julio, 370 del incidente del 04-08, 47 del espejo del 07-09), o sea que el faltante es residuo nuestro, no una deuda probada del cliente. El ámbar "Cerrado con saldo" se reserva para créditos con `creado_por` (hoy: 0 casos). Y el tile del dashboard: "créditos cerrados en el período".

---

## 9. La regla 0148 ("supervisor sin zona no ve nada") nunca se propagó a los textos ni al chat

**Qué pasa.** Desde la 0148 un supervisor sin zona no ve absolutamente nada. Cinco pantallas y el manual in-app dicen lo contrario, y quedó un pedazo de **código** con la regla vieja.

**A quién le pega.** A vos, cuando des de alta al cuarto supervisor.

**Números.** Hoy no muerde: los 3 supervisores tienen zona. Pero `NuevoUsuario.tsx:49, 120` no le pregunta la zona al supervisor (sus zonas viven en `supervisor_zonas`, no en `usuarios.zona_id`), así que **todo supervisor nuevo nace ciego por construcción** — y las tres pantallas que consultarías para entenderlo te juran que "ve todo". El pie de `GestionZonas.tsx:234-237` es el peor: dice *"La restricción es real: la aplica la base de datos"*, e invoca como testigo justamente a la base que dice lo contrario.

**Archivos.** Textos: `components/admin/GestionZonas.tsx:201, 234-237` · `app/admin/(panel)/zonas/page.tsx:32` · `app/admin/(panel)/equipo/page.tsx:126` · `lib/tutorial/contenido.ts:406, 407, 447` (y el título "Zonas (opcional)"). Código: `lib/data/chat.ts:224` (`zonasVisibles = zonasSup.length > 0 ? zonasSup : zonas.map(z => z.id)`) y `:249`. Comentarios: `lib/data/alcance.ts:9-11, 31, 62`, `lib/permisos.ts:77`.

**Arreglo.** Invertir los cinco textos ("Un supervisor sin zona NO ve nada hasta que le marques la primera: la zona es parte del alta"), chip rojo "sin zona · no ve nada" en vez de verde "ve todo", y en `NuevoUsuario.tsx` un aviso al elegir rol supervisor (**no** reusar el `<select>` de zona: escribe `usuarios.zona_id`, que ningún camino de permisos lee para supervisores). En chat: `zonasVisibles = zonasSup` y sacar el `&& zonasSup.length > 0` del filtro de hilos. En el tutorial, la operación "PLANA" sigue existiendo para el admin solo; lo que murió es "en operación plana los supervisores ven todo".

**Aparte, misma pantalla:** `equipo/page.tsx:17` dice "Descargar reportes y respaldo: supervisor ✓" y `/api/reportes` le devuelve **403** a todo lo que no sea admin. Poner `supervisor: "no"` y sacar "dashboard" de la fila 16 (el supervisor es redirigido a Mi jornada).

---

## 10. Números que comparan universos distintos bajo el mismo rótulo

**Qué pasa.** Cinco lugares donde el rótulo no dice qué denominador usa, y por eso el número contradice al de al lado.

**A quién le pega.** Al supervisor y a vos.

**Números.**
- **Dos "% de la meta" en la misma pantalla** (`jornada/page.tsx:301` y `:303`): el héroe divide el recaudo TOTAL por la meta de RUTA; "En vivo" divide el cobrado en ruta por la misma meta. Medido: el 20-08, héroe 13 % vs. En vivo 2 %; el 27-08, 32 % vs. 12 %. El motor: de los pagos nativos de 45 días, **3.132 ($5,44M)** cuelgan de créditos hoy finalizados contra 1.353 ($4,54M) de activos — la renovación borra 30-60 % del cobro del día del lente de ruta. Y los importados fechados hoy inflan el total, con `Math.min(100)` clavando el héroe en 100 %.
- **Chips "vs mes previo"** (`estadisticas/page.tsx:96-98`): el día 9 de 30 se compara contra el mes anterior entero. Hoy los cuatro chips muestran caídas de −83 / −83 / −81 / −32 %. Contra el **mismo tramo** de agosto (1 al 9) los deltas reales son −28 / −52 / −18 / **+9 %**: "Clientes nuevos" está creciendo 9 % y la pantalla lo pinta en rojo bajando 32 %. **El signo invertido**.
- **KPI "Cobradores"** de `/admin/cobranza:65`: es el padrón (**52 fijo, todos los días**), en una fila donde los otros tres son de hoy. Ayer hubo 11 cobros y 1 cobrador. El dato bueno ya se calcula y no se usa. Además `asesor.ts:411` se lo dicta a Aureo como "RANKING DE COBRADORES (hoy): 52 activo(s)".
- **"N clientes listos para renovar"** (`jornada:866`): cuenta créditos. Medido: 395 créditos / 368 clientes (25 personas con 2+). Mismo error en `renovaciones/page.tsx:185`.
- **Dos definiciones de mora**: dashboard $8.309.043 (1.215 créditos, con gracia) vs. `/admin/mora` $13.389.359 (1.500, sin gracia). 61 % más plata a dos clics.
- **"Colocación por mes"** (`0086`, CTE `coloc`) cuenta las ventas deshechas: ago-26 incluye 15 canceladas por $165.000.

**Arreglo.** Un solo "% de la meta" por pantalla, y que sea el de ruta (el que comparte con el teléfono del cobrador); el héroe se queda con el monto total pero **sin** llamarlo "de la meta". Los chips del mes: no mostrar porcentaje mientras el mes esté en curso (mostrar "mes en curso · día 9 de 30") o agregar a `app_stats_mensual` el bucket "mismo tramo del mes previo" y rotularlo "vs 1–9 ago". KPI Cobradores: `${cobradoresHoy} de ${resumen.cobradores}` con "Cobradores en ruta hoy", calculado sobre el mismo feed nativo. "N **créditos** listos para renovar" (no deduplicar por cliente: la pantalla destino lista por crédito, a propósito). Mora: **solo un cartel** de conciliación como el que ya existe en `/admin/cobranza`. Colocación: `and estado <> 'cancelado'`.

---

## 11. La ficha del cliente no resuelve el multi-crédito

**Qué pasa.** Tres defectos en la misma pantalla, todos por lo mismo: la ficha trata al cliente como si tuviera un solo crédito.

**A quién le pega.** A vos, al supervisor y al cliente (el papel que se lleva en la mano).

**Números.** **468 clientes tienen 2 o más créditos activos** (máximo 8), 102 con más de dos. 90 de ellos tienen dos activos con la **misma cuota**.
- **Historial de pagos**: `ficha.ts:156` aplana todos los créditos y cada fila dice solo "Día N", sin decir de cuál crédito. Al lado está el botón **Anular**, que es el único de toda la app. Anular el equivocado mueve la deuda al cartón equivocado (trigger 0063), y el `confirm` dice solo "¿Anular este pago?" — ni monto ni crédito. Hoy hay 2.022 grupos de filas literalmente indistinguibles (109 clientes), aunque casi todos entre importados.
- **Estado de cuenta impreso** (`estado/page.tsx:59`): siempre el crédito más nuevo, sin decir cuál ni que hay otros. La página **acepta `?credito=`** y **ningún link lo emite**. Es el único papel formal con tu sello que se le entrega al cliente, y muestra un "Saldo" que es una fracción de lo que debe.
- **Corte en 100 pagos** sin rótulo (grupo 6).

**Arreglo.** Llevar `prestamoId` en `PagoFicha` (la clave ya está en el `Record`, se pierde en el `flatMap`) y rotular cada fila con un identificador construido sobre **todos** los créditos (monto + fecha de inicio + estado), no con el índice de los activos. Que el `confirm` de `AnularPago` diga monto y crédito. Un link "Estado de cuenta" **por crédito** dentro de cada tarjeta de crédito activo, con `?credito=`. Y en el papel, dentro del área imprimible: "Este cliente tiene N créditos activos; este documento corresponde a uno. Saldo total de los N: $X".

---

## 12. La fecha se arma en UTC y la hora en Uruguay: 1.233 cobros se imprimen con el día siguiente

**Qué pasa.** Cinco copias del mismo helper: `${d.getDate()} ${meses[d.getMonth()]} ${horaDe(iso)}`. `getDate()` usa la zona del proceso (UTC en Vercel), `horaDe` está clavado en Montevideo. Todo lo registrado entre las 21:00 y las 23:59 sale con la fecha de mañana y la hora correcta.

**A quién le pega.** A vos: son las pantallas de arqueo.

**Números.** **1.233 pagos nativos ($2.770.167, el 26,6 %)** y **122 ventas ($1.641.500, 32,5 %)**. Y la franja no es marginal: **las 21h es la hora pico de registro** (752 pagos, más que cualquier hora de calle). En `/admin/movimientos` la contradicción está en la misma pantalla: el encabezado dice "jueves 3 de septiembre" (ese cálculo sí es correcto) y las filas de abajo dicen "4 sep". El CSV del mismo dato sale bien.

**Archivos.** `movimientos/page.tsx:46` · `caja/page.tsx:54` · `recaudos/page.tsx:33` · `capital/page.tsx:21` · `components/admin/HistorialGastos.tsx:10` · `clientes/[id]/page.tsx:63` (solo el uso sobre `p.fecha`).

**Arreglo.** Un helper único en `lib/format.ts` que resuelva día y hora con el mismo `Intl.DateTimeFormat({ timeZone: "America/Montevideo" })`, conservando el formato actual ("3 sep 21:30"). **No** usar `fechaHoraUY` tal cual: imprime "03/09 · 21:30" y cambia cuatro tablas.

**Cuidado (importante):** el bug SOLO existe sobre columnas `timestamptz`. Sobre columnas `date` (`prestamos.fecha_inicio`) el código actual está **bien** y aplicarle timezone lo correría un día para atrás. No tocar `fechaCorta` en `clientes/[id]:288, 323, 329` ni `informe-cartera/page.tsx:22`. Y no tocar los componentes `"use client"` (NotasCliente, GestionCobranza, RegistroRedenciones): corren en el navegador uruguayo y muestran bien.

Test con `TZ=UTC`: `"2026-09-04T00:30:00Z"` debe dar "3 sep 21:30".

---

## 13. La búsqueda de clientes es ciega a las tildes y a los puntos de la cédula

**Qué pasa.** `ilike` en Postgres no pliega acentos, así que "Martinez" y "Martínez" son conjuntos **disjuntos**.

**A quién le pega.** A vos y al supervisor, todos los días. En `/admin/clientes` la búsqueda es el único camino: sin buscar ves 60 fichas de 13.310 ordenadas por nombre.

**Números.** Rodriguez **231** / Rodríguez **212** · Gonzalez 138 / González 129 · Martinez 205 / Martínez 65 · Perez 137 / Pérez 22 · Garcia 107 / García 51. En total **1.787 clientes activos** con tilde o ñ (327 con crédito activo). Y **337 cédulas guardadas con puntos** ("4.282.687-1"), 80 con crédito activo: buscarlas por los dígitos pegados no devuelve nada. Cuando falla, la pantalla imprime `Sin resultados para "Rodriguez"` — una pantalla del panel afirmando una ausencia falsa sobre 212 fichas.

**Archivos.** `lib/data/clientes.ts:287` (lista) y `:240` (el que alimenta Ctrl+K y `/api/buscar-clientes`). Las dos.

**Arreglo.** `unaccent` y `pg_trgm` **no están instaladas** y `unaccent()` no es IMMUTABLE (una columna generada sobre ella es rechazada). Usar `translate()`, que sí es inmutable y no necesita extensión:
```sql
alter table clientes
  add column nombre_busqueda text generated always as (
    lower(translate(nombre,'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'))) stored,
  add column documento_busqueda text generated always as (upper(translate(coalesce(documento,''),'.- ',''))) stored;
```
Y en las dos funciones, una rama `.or()` compartida con `nombre_busqueda.ilike`, `documento_busqueda.ilike` y el documento crudo. El plegado debe ser **simétrico**: quien tipea *con* tilde también tiene que encontrar las 231 guardadas sin ella. Sin índice: el seq scan sobre 13.310 filas mide 33 ms.

---

## 14. La geo-cerca es ciega en el 95 % de los cobros, y en el 5 % que mide acusa al 80 %

**Qué pasa.** Dos defectos encadenados. La cerca solo puede evaluar si el cliente tiene domicilio con GPS; el KPI muestra el numerador sin el denominador. Y cuando sí puede evaluar, las anclas están rotas.

**A quién le pega.** A vos (KPI que no significa nada) y al cobrador (alerta de severidad **alta** con su nombre).

**Números.** 858 de 13.310 clientes con GPS (6,4 %). En 30 días: 3.182 cobros nativos, 2.534 con GPS del teléfono, **160 evaluables (5,0 %)**. Hay días enteros — 43 cobros el 26-08 — donde la pantalla dijo "Fuera de zona: 0" y "Sin anomalías hoy. Todo en orden ✓" sin haber podido mirar un solo cobro.
Y lo otro: de los 163 evaluables, **133 (82 %) dieron "fuera de zona"**, con 40 entre 0,5 y 2 km, 54 entre 2 y 20 km y **30 a más de 20 km**. La causa: **35 clientes tienen `gps_lat` fuera de Uruguay** y 31 el `gps_lng`; uno está anclado en Puerto Rico y genera 5.771 km de "fuga" en 3 cobros. Eso alimenta la única alerta "alta" de la capa, con nombre y apellido, y el peso 15 del score de sospecha.

**Archivos.** `lib/data/control.ts:240-245, 282-291` · `app/admin/(panel)/cobranza/page.tsx:64, 89-93`.

**Arreglo.**
1. Contar `evaluables` en el mismo loop y mostrar el denominador: "0 de 81 · la geo-cerca pudo mirar 81 de 1.089 cobros". Nunca "Todo en orden ✓" con `evaluables === 0`.
2. Descartar anclas fuera del recuadro de Uruguay (lat −35,1..−30,0 / lng −58,5..−53,0) antes de que una distancia se convierta en alerta.
3. No contar como fuga una distancia absurda (>5 km): a esa distancia es ancla rota, no fuga.
4. `control.ts:242` usa `!zona.enZona`, y `evaluarZona` es de **tres** estados: el indeterminado (`null`) se contaría como fuera. Cambiar a `zona.enZona === false` (así ya lo hace `sospecha.ts:96`). Hoy no dispara porque `pagos` no guarda la precisión del fix — que es la otra mitad: el tri-estado que protege al cobrador con mala señal está muerto en este camino.

---

## 15. El panel es más restrictivo que la calle: los forms bloquean con un techo que vos derogaste el 06-09

**Qué pasa.** Desde el 06-09 no hay tope por encima del +20 % cuando existe un crédito anterior (`maximo: null`), solo aviso. Los dos formularios del panel siguen apagando el botón.

**A quién le pega.** A vos y al supervisor, en la pantalla donde deberían tener **más** autoridad que la calle.

**Números.** Con un anterior de $30.000, el form corta en $100.000 y dice "No permitido — Más que eso en una sola renovación no se autoriza". Verificado ejecutando el dominio real: `resolverCredito` con monto $120.000 devuelve `{via:"crear", sobreCap:true}` — el servidor **lo crea**. Y el cobrador coloca esos $120.000 desde la calle con un aviso ámbar. El propio `lib/domain/credito.ts:300-304` dice que `techoRenovacion`/`techoVentaGestor` "ya no deciden nada acá"; los forms las siguen llamando directo.

**Archivos.** `components/admin/FormRenovacion.tsx:108, 189, 312, 360` · `components/admin/FormCreditoNuevo.tsx:125` · comentario mentiroso en `FormRenovacion.tsx:102-106` y `renovaciones/actions.ts:137-140`.

**Arreglo.** Que el servidor calcule `techosDe(via, "gestor", referenciaDe(anterior))` y le pase `{propio, maximo}` como props al form (patrón que ya usa la calle vía `lib/data/colocar.ts`; **no** importar `lib/domain/credito` desde un componente cliente: arrastra `node:crypto`). Bloqueo solo con `maximo != null && monto > maximo` — así se **conserva** el CAP del primer crédito, que el servidor sí rechaza. Por encima de `propio`, ámbar con el texto honesto para el panel: "Es más del +20 % sobre el anterior. Lo autorizás vos y queda en la auditoría con tu nombre" (el push de sobre-techo solo se dispara para cobradores, no para gestores).

---

## 16. Queda el filtro viejo `disapp_credit_id is null` como proxy de "nació en la app"

**Qué pasa.** El empalme **adopta** el crédito nativo y le estampa la ref de Disapp. El 08-09 se corrigieron tres archivos; quedan dos.

**Números.**
- `lib/data/promos.ts:159` (raspaditas por ciclo completado): de 104 finalizados nativos, **47 ya están estampados** → 45 clientes pierden la raspadita que ganaron. Latente: el gatillo hoy es `'pago'`. Se arma con dos clics en `/admin/promos`, y el rótulo del selector promete "Una por cada crédito que completa/renueva".
- `lib/data/reconciliacion.ts:565` (INV11): **219 de los 265 activos nativos ya están estampados** (83 %). El más avanzado va $11.500 de $12.000: **está a un pago de $500** de disparar un hallazgo de severidad **alta** que te va a llegar por mail y push diciendo "Disapp ya lo cerró — finalizarlo" sobre un crédito que colocó un cobrador de la app. Finalizarlo mata la renovación. Hoy: 0 falsos positivos.

**Arreglo.** `promos.ts`: `.not("creado_por", "is", null)` (verificado: hay 0 finalizados sin `creado_por` y sin `disapp_credit_id`, así que la protección original —que 15 créditos Disapp no den 15 raspaditas— queda intacta). `reconciliacion.ts`: traer `creado_por` en el select y `importado: p.creado_por == null && p.disapp_credit_id != null` (el texto afirma "Disapp ya lo cerró", así que conviene exigir las dos cosas). Corregir el docstring de `lib/reconciliacion.ts:402`, que fosiliza la regla vieja. Y un guardián de código fuente con allowlist (los usos legítimos de `disapp_credit_id` son los de reconciliación como marca de procedencia).

---

## 17. `/admin/renovaciones`: tres barridos redundantes y un N+1, sin timeout

**Qué pasa.** La pantalla donde se decide re-colocar capital se baja la tabla de clientes entera antes de tocar un crédito.

**Números (medidos).** `getClientesAsignados` trae los **13.310 clientes activos con `select("*")` en 14 páginas encadenadas: 10,26 MB, 3.257 ms de mediana** — para usar 2.266. Después `traerTodo` sobre `prestamos` (3 páginas más) pide exactamente las 8 columnas que la RPC `app_cartera_activa` ya devuelve en la línea siguiente. Y después 60 candidatos × 2 consultas encadenadas de historial = **120 requests**. La página no tiene `conTimeout`: es de las pocas pesadas sin él, así que un cuelgue da un 504 crudo en vez de "Reintentar".

**Archivos.** `lib/data/renovaciones.ts:94, 101-108, 131, 187-189` · `app/admin/(panel)/renovaciones/page.tsx:48` · `lib/data/clientes.ts:187-225`.

**Arreglo.** Armar los candidatos desde `getActivosConPagos` (que ya se llama y trae crédito + `cliente_nombre/documento/telefono/calificacion` + `pagado`), borrando las dos consultas de arriba. Angostar `CandidatoRenovacion.cliente` a lo que la pantalla usa (id, nombre, documento). Batchear los historiales en 2 pasos con `traerTodo` (son 331 préstamos y **4.720 pagos** para 55 clientes: sin paginar se pierden 3.720 filas en silencio y el score decide mal). Envolver en `conTimeout(..., 22_000, "admin.renovaciones")`.

**Dos cuidados:** hay **127 créditos empatados en 100 %** de progreso y el corte es de 60 — hoy el orden alfabético de `getClientesAsignados` lo hace determinista; si se saca, hay que agregar desempate explícito o la lista baraja en cada carga. Y `app_cartera_activa` no filtra `clientes.activo` (hoy: 0 casos, pero declararlo).

**En la misma línea:** `lib/data/periodo.ts:201` se baja **16.090 préstamos en 17 páginas** para quedarse con 375 al elegir "Año" — arreglo de una línea: `.not("creado_por", "is", null)` en la consulta. También pega en `/admin/cierre`, que lo llama en cada carga.

---

## 18. Tienda: datos que se graban y se tiran

**Qué pasa.** La migración 0149 guarda folio, cantidad y plazo pedido; las dos bandejas del panel los descartan al mapear.

**Números.** `tienda.ts:542` reconstruye el objeto campo por campo y omite los tres → el guardrail post-incidente de `TiendaManager.tsx:922-927` ("El cliente pidió ×N unidades. Esta venta sale por UNA") **nunca se dibuja**, y el folio que el cliente guarda en su comprobante no aparece en ningún lado. Lo mismo en `leadsPublicos.ts:24` (el único lead existente **tiene folio**: PY-U6UXU9) — y ahí ni siquiera se muestra `mensaje`, que es donde viaja el "x{cant}" del carrito. Hoy no muerde (3 solicitudes, 0 con cantidad>1) porque la tienda no vendió; muerde la primera vez que alguien pida dos.

**Arreglo.** Agregar los campos al mapeo y **sacarles el `?` en la interfaz**, para que el compilador obligue a mapearlos. En el panel del prospecto público, pintar además `mensaje`.

**Del mismo bloque:** `presupuestoJuegos.ts:117-123` suma cuatro fuentes y **tres no tienen camino de escritura** (rifa, canje de estrellas y quiniela: solo la raspadita tiene el trigger de 0130). El panel dice "Cuánto cuestan de verdad las raspaditas, quinielas y rifas" y pinta semáforo de tope y proyección sobre un total que ignora tres cuartos. Y `CalculadoraPrecios.tsx:162` imprime "ganás $-5.000" en verde cuando el margen es negativo — arreglo de color y verbo, **sin** bloquear el guardado (vender bajo costo es una decisión comercial válida).

---

## 19. `Mi jornada`: 7 olas de await en serie y `supervisor_zonas` leída 3 veces

**Qué pasa.** La pantalla que el supervisor abre todo el día encadena esperas que no dependen entre sí, y lee dos tablas de catálogo varias veces en el mismo render.

**Números.** Cuatro de las siete olas (`:209` zonas, `:238` sin rendir, `:258` bases, `:316` pendientes) no dependen de nada de lo anterior. `supervisor_zonas` se lee 3 veces (una en `actorDeUsuario`, otra en `:104`, otra completa en `:212`) y `zonas` 2. Post-0159 la pantalla está en ~1,2 s: se ganan ~0,3-0,5 s.

**Arreglo (con dos trampas).**
1. **No** hoistear promesas desnudas: el bloque `:238` está envuelto en try/catch a propósito ("nunca tumba la página" — es la corrección de la queja de que el aviso de cajas sin cerrar solo lo veía quien llegaba al cierre). Si entra crudo en un `Promise.all`, un fallo mata la pantalla. El `.catch` va **pegado a la creación**.
2. **No** derivar `zonaNombre` del mapa de `:218`: la rama de historial retorna en `:146` y lo usa en `:132`. Subir la lectura de `zonas` (8 filas) **antes** del early-return y derivar el rótulo de `actor.zonasSupervisadas`, que ya está resuelto.

---

## 20. Latentes y de higiene (hoy no muerden, arreglo barato)

| Qué | Archivo | Estado hoy |
|---|---|---|
| "Desactivar zona: los cobradores quedan sin zona" — el confirm miente, solo oculta la zona y no se puede reactivar desde el panel | `GestionZonas.tsx:119`, `lib/data/zonas.ts:157` | 8 zonas, todas activas, botón nunca usado |
| Confirmar y rechazar anulación sin candado de estado (`.eq("estado","pendiente")`) — una carrera deja el pago anulado con la solicitud diciendo "rechazada" | `lib/acciones/anulaciones.ts:404, 416, 460` | `solicitudes_anulacion` **vacía** |
| Las discrepancias que abre una anulación (comisión ya pagada, write-off) no las lista ninguna pantalla | `lib/acciones/anulaciones.ts:150-153`, `lib/data/discrepancias.ts` | `comisiones_liquidadas` = 0 filas |
| El gasto que carga el supervisor en `/admin/caja` no aparece en su propia caja (`.in()` no matchea NULL) | `lib/data/caja.ts:143` | `movimientos_caja` = **0 filas** |
| La vigilancia degrada a $0 mudo ante cualquier error de la RPC (catch pelado) | `lib/data/vigilancia.ts:111` | RPC viva; filtrar con `funcionFaltante` y relanzar el resto |
| `jugarRaspadita` no mira el kill-switch ni la audiencia | `app/c/[token]/actions.ts:328` | Arreglo de 1 línea en `promos.ts:214` (apagar el cupo si `!ajustes.activo`) |
| `otorgarRaspaditasAction` acepta supervisor (`esGestor`) cuando la pantalla es admin-only, y la RLS de insert también | `lib/acciones/promos.ts:81` + `raspa_otorgadas_insert` | Cambiar a `esAdmin`; la RLS es la que manda |
| El alta de usuario audita con el UUID de Auth, no con `usuarios.id` | `lib/acciones/usuarios.ts:81` | 0 filas históricas; oportunista |
| "Banner al equipo" dice "tu equipo" y le llega a los 52 de las 3 zonas; apagarlo no deja rastro | `banner-equipo/page.tsx:22`, `bannerCobrador.ts:126` | Hay 2 banners activos desde julio, uno de perfumes del 21-07 |
| CSV de comisiones exporta siempre el período en curso (no acepta `?ref`) | `app/api/reportes/[tipo]/route.ts:168` | 0 comisiones liquidadas en todo el piloto |
| Cola muerta de `solicitudes_renovacion` en el hub: la tarjeta dice "el cobrador NO puede entregar la plata hasta que respondas", regla derogada el 06-09 | `jornada/page.tsx:465` | 0 pendientes, 0 escritores. Borrar la tarjeta |
| `/admin/mora` renderiza las 1.500 fichas sin tope (3.000 islas de cliente) | `mora/page.tsx:227` | Recortar el **render** a 25-50 + `<details>` |

---

## NO HACER (arreglos propuestos que rompen algo)

Esto es lo más importante del informe. Varios de los "arreglos" obvios hacen más daño que el bug:

1. **Desactivar zona con cascada** (`usuarios.zona_id = null` + borrar `supervisor_zonas`): con las policies de 0159, nulear la zona de los 19 cobradores de Zona Centro deja a su supervisor sin ver **ni un cliente, préstamo o pago**, y le cierra `cierres_zona`. Convertiría un P3 latente en un P1 de visibilidad con un clic. Además no hay transacción: son tres updates sueltos por PostgREST. El arreglo es el confirm honesto + guardia que impida ocultar una zona ocupada + botón de reactivar.
2. **Listar zonas sin actividad en el Cierre**: habilita `BotonCerrarZona` con $0 y permite **sellar un acta inmutable de un día que nadie trabajó**. Solo el texto.
3. **Subir `ENTREGA_DIFERIDA_VENTANA_DIAS`** de 30: mueve comisiones ya liquidadas. Es tu regla y está sellada por test. Se separa la ventana de lectura, no la de escritura.
4. **Unificar la mora** del dashboard con la de `/admin/mora`: `asesor.ts:119-123` lo prohíbe explícitamente ("colapsarlas cambiaría un número que el dueño ya reconcilió contra Disapp"), y `montoVencido` es además la base del recargo y el monto sugerido de cobranza. Solo cartel.
5. **Subir `UMBRAL_MEDIO` o exigir monto mínimo** para reducir las 1.500 fichas de mora: de esas, 1.498 tienen deuda vencida real ($13,4M). Eso convierte atraso real en "Al día". Lo que hay que recortar es el **render**. (Y ojo: buena parte del atraso es que el libro está viejo — el último empalme llegó al 05-09, faltan 3-4 días de cobro. Vale poner esa fecha arriba de la lista.)
6. **Cambiar `fecha_inicio` por `creado_en`** en "Colocación por mes": el empalme estampa `creado_en` = momento del import, así que jul-26 pasaría a $295.988.805 y feb–jun a $0.
7. **Aplicar timezone a `fechaCorta` sobre `fecha_inicio`**: es columna `date`; le correría el día para atrás. Solo `timestamptz`.
8. **Poner "− lo que declaró quedarse para mañana" en los cuatro textos del esperado**: el retenido NO va en el esperado del cobrador, solo en el de la zona. Sería la mentira inversa.
9. **Pintar los 962 finalizados con deuda como "Cerrado con saldo" en ámbar**: son 100 % importados. Acusaría al cliente por residuo de nuestro empalme. Rótulo neutro.
10. **Bloquear el guardado en la calculadora de precios cuando `precio < costo`**: vender bajo costo (liquidación, producto gancho) es legítimo y no llega al cliente. Solo color y verbo.
11. **Saltear los refinanciados del score del cliente**: el 77,7 % pagado también sale del denominador y hunde a algunos a banda "nuevo". Y "madurar hasta `refinanciado_en`" no es implementable: esa columna guarda el instante en que corrió el script de marcado, no la fecha del rollover. Impacto real medido: mediana +1 punto, 8 clientes cruzan un umbral, en las dos direcciones. **Dejarlo.**
12. **`rec.cobradores` para el KPI "Cobradores"**: cuenta cualquier `registrado_por` de cualquier pago, incluidos los importados — el 05-09 diría "42 cobradores hoy".
13. **Meter el N+1 de renovaciones en un `.in()` suelto**: son 4.720 pagos, PostgREST corta en 1000 y el score decidiría con la mitad del historial.

---

## ARREGLAR YA
*(miente sobre plata, rompe, o es un agujero de control)*

1. **Grupo 1** — Correr la 0096 corregida (0160). `mora_notas` con borrado cross-zona y las tres `config_*` de plata escribibles por REST son lo más grave del informe. Más el check de policies contra los archivos, no contra el snapshot.
2. **Grupo 2** — Restar el capital colocado en `centroAlertas.ts:98` y corregir los 4 textos de la fórmula del esperado (+ `vigilancia.ts:273`).
3. **Grupo 3** — `.is("origen", null)` en `caja.ts` (45× en Total Entradas), `app_cobros_mes` (el "2 % auditable"), `app_stats_mensual` ($14,7M en 8 barras). Rótulos de Movimientos y Comisiones.
4. **Grupo 6, primer bloque** — El CAP de `/admin/auditoria` (12 de 16 cobradores en cero, $3,6M ocultos) y el `.limit(20000)` de `/admin/uso` (muerde hoy).
5. **Grupo 4** — Banda "sin datos" en el score y separar "sin acta" de "faltante". Hoy la pantalla anti-fuga señala exactamente a los que adoptaron.
6. **Grupo 7** — "Cuota diaria" / "Días atraso" sobre el 62,7 % del capital, y ampliar el guardián.
7. **Grupo 8** — "Pagado ✓" verde sobre 962 créditos con $8,3M.
8. **Grupo 5** — El escudo verde que contradice a la tarjeta roja, y sacar el backlog de $3,24M de la invisibilidad.

## ARREGLAR PRONTO

9. **Grupo 9** — La regla 0148 en los 5 textos + el fallback de chat + el aviso en el alta (y la matriz de permisos).
10. **Grupo 10** — Los dos "% de la meta", los chips "vs mes previo" (uno con el signo invertido), el KPI "Cobradores", "clientes vs créditos", el cartel de conciliación de mora, las canceladas en "Colocación por mes".
11. **Grupo 11** — Ficha multi-crédito: rótulo por crédito en el historial de pagos (con el botón Anular al lado), link `?credito=` al estado de cuenta, y decir el corte de 100.
12. **Grupo 12** — La fecha UTC en las 5 pantallas de arqueo.
13. **Grupo 13** — Búsqueda sin tildes ni puntos de cédula (las dos funciones).
14. **Grupo 15** — Los forms del panel con el techo derogado.
15. **Grupo 14** — Denominador de la geo-cerca y saneo de anclas fuera de Uruguay.
16. **Grupo 16** — Los dos `disapp_credit_id` que quedan, sobre todo `reconciliacion.ts:565` (está a un pago de $500 de mandarte un mail pidiendo cerrar un crédito vivo).
17. **Grupo 6, segundo bloque** — `.order("id")` en `operacion.ts` (4 líneas), rótulos de corte en el libro de caja y el historial de pagos, `proyeccion.ts` pidiendo una columna que no existe, y el guardián de `traerTodo`.
18. **Grupo 17** — Renovaciones (10 MB por carga + 120 requests + sin timeout) y el "Colocado del año" (16.090 filas para 375, una línea).

## PUEDE ESPERAR

19. **Grupo 18** — Tienda: folio/cantidad en las dos bandejas, presupuesto de premios sin costo cargable, calculadora en verde.
20. **Grupo 19** — Las olas en serie de Mi jornada y las lecturas repetidas de `supervisor_zonas` (~0,3-0,5 s).
21. **Grupo 20 entero** — Los 12 latentes: desactivar zona, candado de anulaciones, discrepancias sin lector, gasto del supervisor, vigilancia muda, raspadita sin kill-switch, `otorgarRaspaditas` con `esGestor`, auditoría del alta, banner al equipo, CSV de comisiones sin `?ref`, cola muerta de pedidos, recorte del render de mora.
22. **Comisiones cae a la base 30× si falla la RPC** (`comisiones.ts:29`, catch pelado) y el flag `atribuidoPorRuta` que se calcula y **nunca se renderiza**. El botón Liquidar ya está bloqueado, así que la plata está salva; lo que falta es que la pantalla lo diga en vez de mostrar $238.669 donde van $8.043. Y el CSV de `/api/reportes/comisiones` exporta esa base sin ninguna guardia.
23. **Score del cliente y refinanciados** — impacto medido de ~1 punto de mediana, bidireccional. Documentar la decisión al lado de `lib/scoring.ts:136` para que no vuelva a levantarse como bug, y listo.
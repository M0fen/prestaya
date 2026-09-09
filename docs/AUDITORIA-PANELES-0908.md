# Plan de ataque — auditoría /admin/en-vivo + /admin/piloto

35 hallazgos → **12 causas raíz**. Ordenado por daño/esfuerzo. Las tandas 1 y 2 son ~250 líneas en total.

---

## TANDA 1 — Mienten HOY, con plata, y se arreglan en minutos

### A1. El discriminador de "nativo" está mal: se filtra por la columna que el espejo ESTAMPA después
**Causa raíz:** se usa `disapp_credit_id is null` / `disapp_id is null` para decir "esto nació en la app", pero el empalme *adopta* el crédito nativo y le estampa la ref de Disapp; el discriminador real es `creado_por` (ningún importador lo setea) y `origen='censo'`.

**Daño medido:** ventana 26-08→08-09 la app colocó **61 créditos / $840.500** y el panel muestra **3 / $42.000** (−95%, 13 de 14 barras en cero, el 27-08 solo son $337.500). 266 de 375 créditos nativos tienen `disapp_credit_id`. Y la barra que hoy sale bien **desaparece mañana** cuando corra el próximo empalme: el panel se reescribe hacia atrás. En censos: 4 falsos positivos firmados "—" (filas del import) y 4 de 11 censos reales invisibles, por `unificar-fichas-dobles.py:269-271`, que intercambia el `disapp_id` entre la ficha importada y la nativa.

**No es solo dev:** `informeDia.ts` alimenta `/cobrador/informes`, `/admin/jornada` y `/admin/movimientos`; `actividad.ts` alimenta `/admin/auditoria` (requireAdmin).

**Archivos y cambio (6 líneas):**
- `lib/data/piloto.ts:131` — borrar `.is("disapp_credit_id", null)`, dejar `.not("creado_por","is",null)`
- `lib/data/informeDia.ts:210` — `.is("disapp_credit_id",null)` → `.not("creado_por","is",null)` **(esta primero: la ve el cobrador)**
- `lib/data/actividad.ts:147` (creditosQ) y `:367` (getResumenHoy) — mismo swap
- `lib/data/actividad.ts:155` (censosQ) y `:378` — `.is("disapp_id",null)` → `.eq("origen","censo")` (tiene índice `(origen, creado_en desc)`, 0005)
- **No tocar** `reconciliacion.ts:565` (`importado: disapp_credit_id != null`): ahí la columna se usa con su significado verdadero.

**Verificado seguro:** las únicas 11 filas con `creado_por` null y sin `disapp_credit_id` están todas `cancelado`, ya excluidas por el `.neq("estado","cancelado")` existente.

**Chequeo post-fix:** la ventana debe dar 61 / $840.500 y 8 barras no vacías.

**Cubre:** "Capital colocado desde la app muestra $42.000" (P1), "Censó a X cuenta importaciones" (P2).

---

### A2. El "último cobro" se lee con un `.limit()` global que PostgREST corta en 1000
**Causa raíz:** `getCobradoresEnSilencio` pide "los N pagos nativos más nuevos de TODA la operación" y se queda con el primero de cada cobrador; con `LOTE_IN=150` los 52 entran en un solo lote, así que la ventana es global y hoy llega solo hasta el **20-08**.

**Daño medido:** 14 cobradores que SÍ cobraron figuran con `diasSinCobrar = null`. El bloque dice **4 cobradores / $5.061.405** cuando la verdad son **18 / $21.530.905**. Los $16.469.500 restantes se van al renglón "nunca cobraron por la app" — que en `/admin/operacion` (**requireGestor**, lo ve el dueño y los supervisores) se imprime **con nombre y apellido**: María Curbelo con 272 cobros nativos, Karent Londoño con 366. El sesgo está invertido: cuanto más tiempo lleva alguien sin mirar su cartera, más garantizado es que se caiga de la lista accionable (Luz Angela Idrobo, 57 días, $1,34M, 130 clientes).

**Archivo:** `lib/data/operacion.ts:129-143`.

**Arreglo mínimo (un pago por cobrador, medido en 910 ms vs 5.497 ms de `traerTodo`):**
```ts
const ultimo = new Map<string, string>();
for (const tanda of enLotes(ids, 12)) {
  const res = await Promise.all(tanda.map((id) =>
    db.from("pagos").select("registrado_en")
      .eq("anulado", false).is("origen", null).eq("registrado_por", id)
      .order("registrado_en", { ascending: false }).limit(1).maybeSingle()));
  res.forEach((r, i) => { const v = r.data?.registrado_en; if (v) ultimo.set(tanda[i], v); });
}
```
**No** usar RPC `SECURITY DEFINER`: `/admin/operacion` pasa el cliente con RLS y una RPC definer ampliaría lo que ve un supervisor. Si se prefiere `traerTodo`, hay que cambiar el `if (!ultimo.has(k))` por un **MAX explícito** (al ordenar por `id` deja de venir por fecha) — si no, el indicador se invierte en silencio.

**Yapa gratis del mismo bloque:** hoy se destructura solo `{ data }` y se descarta `error`; con la consulta caída los 47 salen como "nunca cobraron". Leer `error` y lanzar.

**Cubre:** los dos P1 de "nunca cobraron por la app".

---

### A3. Ventanas mezcladas: el campo se calcula sobre 7 días y el rótulo dice 14
**Causa raíz:** en el acumulador del equipo el `if (!dias7.has(dia)) continue;` está **antes** de actualizar `a.ultimo`, así que `ultimoCobro` nunca ve los días 8-14 aunque los pagos ya estén en memoria.

**Daño:** ~3 filas (de las 5 que cobraron en 14 días) dicen hoy **"nunca en 14 d"** siendo falso, y el panel se contradice: las barras "Recaudo nativo por día" de arriba dibujan esos mismos cobros, y las columnas vecinas "Última acta"/"Última base" sí son de 14 días. En la misma fila conviven dos ventanas con el mismo rótulo.

**Archivo:** `lib/data/piloto.ts:216-226` + `app/admin/(panel)/piloto/page.tsx:184`.

```ts
for (const p of pagos) {
  if (!p.registrado_por) continue;
  const dia = fechaISOUY(new Date(p.registrado_en));
  const a = porCob.get(p.registrado_por) ?? { cobros: 0, recaudo: 0, dias: new Set<string>(), ultimo: null };
  if (dias7.has(dia)) { a.cobros += 1; a.recaudo += Number(p.monto); a.dias.add(dia); }
  if (!a.ultimo || p.registrado_en > a.ultimo) a.ultimo = p.registrado_en; // 14 d
  porCob.set(p.registrado_por, a);
}
```
Y el texto: `"nunca en 14 d"` → `"ninguno en 14 d"` (en este repo "nunca" significa "jamás usó la app", ver `operacion.ts:49`).

**Cubre:** "nunca en 14 d: la cuenta se hace sobre 7 días" (P1).

---

### A4. `promedioHabil` suma los domingos arriba y los resta abajo
**Causa raíz:** numerador = los 14 días, denominador = los 12 hábiles. El JSDoc y el rótulo prometen "promedio de los días hábiles"; el test lo consagra con `155` (el promedio real es `150`).

**Daño:** hoy 0 (los domingos de la ventana están vacíos), pero **el domingo 09-08 tuvo 288 pagos nativos por $2.056.571** — el día individual de mayor recaudo nativo del piloto. Con ese domingo dentro de la ventana, "prom. hábil" se inflaba **$171.381 por día** (+47% a +83% según la ventana), en las 6 tarjetas.

**Archivos:** `lib/piloto/series.ts:49`, `lib/piloto/series.test.ts:39`.
```ts
const promedioHabil = habiles.length ? habiles.reduce((a, p) => a + p.valor, 0) / habiles.length : 0;
```
`total` y `max` NO se tocan (el pie dice "total" y el domingo es plata real). Test: `promedioHabil: 150`, y agregar un caso con domingo grande.

**Cubre:** los 3 hallazgos de "prom. hábil".

---

## TANDA 2 — Mienten cuando algo se rompe o cuando la adopción crece

### B1. Totales derivados de una lista capada, con rótulo que promete el día entero
**Causa raíz:** `resumenDe(personas, feed)` cuenta sobre el feed **ya recortado** (`TOPE_FEED=400`, `NAVS_EN_FEED=150`), y aguas arriba `getActividad` capa en `CAP=500` por fuente. Los KPI dicen "hoy" y miden "lo que sobrevivió al corte". El de al lado sí declara su tope ("últimas 150"): la asimetría entrena a creer que cuando hay corte se avisa.

**Daño medido:** el **07-09** hubo ~887 hechos (880 filas de auditoría) y el KPI no podía pasar de ~307-400. Reproduciendo `mezclarFeed` contra la base, el tope muerde en **22 de los últimos 40 días** (08-08: KPI 250 vs 623 reales; navegaciones 150 vs 1.726). En la misma pantalla, la columna izquierda muestra `hechosHoy`/`vistasHoy` sin recortar: **cinco personas solas superan el total del KPI**. La plata: `cobros/cobrado` salen de `hechoPor` (pre-corte de 400) pero heredan el CAP=500 de `pagosQ`, y el pico real ya fue **465 pagos nativos el 11-08 — 93% del tope**.

**Archivos:** `lib/data/enVivo.ts`, `lib/enVivo/clasificar.ts`, `components/admin/EnVivoTablero.tsx`. **No tocar `getActividad`**: la comparte `/admin/auditoria` con rangos de 30 días.

**Arreglo:**
1. `resumenDe(personas, totales)` en vez de `resumenDe(personas, feed)`, con `{ hechos: feedHechos.length + feedBit.length, navegaciones: navs.length, hechosTopeados: hechosHoy.length >= 500 }` calculados **antes** de `mezclarFeed`. `navs` ya viene entero por `traerTodo` → "Navegaciones" pasa a ser exacto con cero consultas.
2. La plata sale de su propia consulta, no del feed:
```ts
segura(traerTodo<{id:string;registrado_por:string|null;monto:number}>((d,h) =>
  admin.from("pagos").select("id, registrado_por, monto")
    .is("origen",null).eq("anulado",false).gte("registrado_en", desdeIso)
    .order("id",{ascending:true}).range(d,h)), [], "envivo:cobros", caidas)
```
y `cobrosHoy`/`cobradoHoy` desde ese Map. Hoy son 11 filas; el índice `idx_pagos_registrador_fecha` ya existe.
3. Rótulos: `"Hechos hoy"` → valor `${n}+` con sub "tope de lectura alcanzado" cuando `hechosTopeados`; `"Navegaciones"` sub → "pantallas abiertas hoy" (el 150 pasa a la cabecera del feed); el pie `"y N más hoy"` → "y N más en la línea de tiempo".
4. Test en `clasificar.test.ts`: 600 hechos con tope 400 → `resumen.hechos === 600`.

**Cubre:** los 5 hallazgos de "Hechos hoy / Navegaciones capados" + "los números de plata capados a 500".

---

### B2. Degradación muda: una fuente caída se pinta como cero, y el cero se pinta como afirmación positiva
**Causa raíz doble:** (a) `enVivo.ts:37` traga todo con `void tablaFaltante(e)` — que es un **predicado puro, o sea código muerto** — sin acumular caídas ni reportar; (b) en los DOS paneles, las consultas escritas como `.then(r => r.data ?? [])` **nunca rechazan** (supabase-js resuelve con `{data:null,error}`), así que ni el `caidas` de `piloto.ts` las ve: hoy sólo cubre timeouts.

**Daño:** en `/admin/en-vivo`, si cae `usuarios` el KPI dice "0 de 0 con credenciales"; si caen navs+actividad la pantalla **afirma** "Nadie con señal en los últimos 10 minutos" y "Todavía nada hoy", con el punto verde pulsando ("actualizado hace 3 s"), porque `fallos` sólo cuenta fallos HTTP del fetch. En `/admin/piloto`, `sinRuta` degrada a `null` → `?? 0` → tile **VERDE** con "todo crédito activo está en una ruta", y `silencio` degrada a `[]` → "Nadie con cartera lleva 3 días sin cobrar" tapando $21,5M. Esto contradice de frente el contrato escrito en `lib/timeout.ts:10`: *"Money-safe POR DISEÑO: LANZA, nunca devuelve un valor por defecto — así jamás puede degradar a un $0 falso"*. Y con la adopción real (2 de 52 en 7 días) un vacío falso queda camuflado dentro de un vacío verosímil.

**Archivos:** `lib/data/enVivo.ts`, `lib/enVivo/clasificar.ts`, `components/admin/EnVivoTablero.tsx`, `lib/data/piloto.ts`, `app/admin/(panel)/piloto/page.tsx`.

**Arreglo, en este orden (invertirlo publica un rótulo nuevo que miente):**
1. **Que los errores existan.** Helper y aplicarlo a las 4 fuentes de enVivo (`staff`, `zonas`, `supZonas`, `clientes`) y a las ~8 equivalentes de piloto.ts:
```ts
const filas = <T,>(q: PromiseLike<{data:unknown;error:unknown}>) =>
  Promise.resolve(q).then((r) => { if (r.error) throw r.error; return (r.data ?? []) as T[]; });
```
2. **Que se registren.** `segura(p, vacio, etiqueta, caidas)` con `caidas.push(etiqueta)` + `if (!tablaFaltante(e)) reportarError(etiqueta, e)` — **`reportarError` de `lib/observabilidad.ts`**, no `captureException` (no existe en el repo) ni `console.error` (Sentry está apagado, `reportarError` cae a log estructurado). Agregar `caidas: string[]` a la interfaz `EnVivo`.
3. **Que la pantalla lo diga antes de los números.** Banner ámbar en `EnVivoTablero` (en el cliente, que se repuebla cada 20 s), chip de cabecera en ámbar cuando `caidas.length > 0`, y textos condicionales: con la fuente caída, "no pudimos leer la señal" — **nunca** "Nadie".
4. **En piloto:** `const cayo = (e) => d.caidas.includes(e)` y pasar `Tile` a `estado="neutro"` / valor "—" / sub "no se pudo medir"; `Fila` acepta un tercer estado gris. Aplicar a: sin ruta, silencio (incluye `nuncaCobraron`), gastos, anulaciones, jornadas, incidencias, kill switch (sub: "no se pudo leer el flag · la app deja escribir igual"), **y la tabla de equipo** (si cae "pagos nativos" hoy acusa a los 52 de no cobrar, que miente más fuerte que un verde). Corregir el banner: "se muestran en cero" → "no se pudieron medir".
5. `getActividad` traga sus 9 sub-fuentes en su propio `segura`. Mínimo: `reportarError` ahí; ideal: que devuelva sus etiquetas caídas y enVivo/piloto las concatenen. **Sin esto, "$0 cobrado" sigue mudo** — no prometer que el fix lo cubre.

**Palanca de fondo:** `getClientesSinRuta` hace ~85 round-trips secuenciales y es la pata que va a caerse primero. La **0158 (`piloto_mediciones()`) ya calcula `sin_ruta` en SQL**: cablearla la saca de la zona de timeout. (Aparte: sus dos `traerTodo` en `operacion.ts:217-224` **no llevan `.order("id")`** antes del `.range()` — sobre 10.597 filas eso repite o saltea clientes.)

**Cubre:** los 4 hallazgos de degradación silenciosa (en-vivo y piloto).

---

### B3. `.limit(5000)` sin paginar: PostgREST corta en 1000 en silencio
**Causa raíz:** tres consultas nuevas usan `.limit(5000)` sin `.order()` ni `traerTodo`, cuatro líneas debajo de la de `pagos` que sí lo hace bien. El repo ya midió este bug ("la ventana tenía 1.074 eventos y la pantalla recibía 1.000", `uso.ts:175`).

**Quién muerde de verdad:** sólo **`prestamos`** — `rendiciones` y `aperturas_caja` tienen `unique (cobrador_id, fecha)`, o sea techo duro de 52×14 = 728 filas. Pero las tres se arreglan igual, porque hoy `.then(r => r.data ?? [])` **se come el error** y pinta ceros sin sumar a `caidas` (ver B2).

**Archivo:** `lib/data/piloto.ts:135, 146, 157` → `traerTodo<T>((d,h) => …​.order("id",{ascending:true}).range(d,h))`. Con los volúmenes de hoy es UNA sola request: costo cero.

**Cubre:** los 2 hallazgos de `.limit(5000)`.

---

### B4. El tile del espejo con Disapp: color derivado de un dato curado a mano, sin plata, sin frescura y sin guarda de coherencia
**Causa raíz:** `pctExactos` es un % de FILAS sobre constantes tipeadas a mano en `empalmes.ts`, y de él sale el color, sin mirar la plata, sin mirar la fecha y sin verificar que la fila cierre.

**Cuatro defectos del mismo tile:**
1. **`tot === 0` → "0% exactos" en ROJO.** Ya pasó: la fila del 17-08 no tiene espejo medido. La tabla de abajo, en el mismo archivo, ya resuelve ese caso con `"—"`. *(Este es el único indiscutido; hacerlo sí o sí.)*
2. **La fila del 04-08 es aritméticamente imposible:** `activosApp/Disapp: 2817` con `exactos: 2828` — más aciertos que créditos comparados, y `pasados: 0 / montoPasados: 0` cuando los logs de la corrida (`scripts/_empalme_log_2026-08-05.json`) dicen `exactos 2798, pasados 10` sobre 2.808 del export. Es un engrudo de dos corridas. **Y la fila del 07-09 repite `montoCortos: 6343 / montoPasados: 3239631` idénticos al 06-09** mientras `exactos` sí cambió: esos montos no se re-midieron.
3. **El denominador excluye `noEstanEnApp`**, así que la pantalla dice 92% donde `verificar-post-empalme.py` dice 90,6%.
4. **Ninguna señal de antigüedad:** pasan tres empalmes sin anotar y el tile sigue afirmando "92% exactos" en verde.

**Archivos:** `app/admin/(panel)/piloto/page.tsx:50, 112-118`, `lib/piloto/empalmes.ts`, `lib/piloto/hitos.ts:126`, + test nuevo.

**Arreglo:**
```ts
const totEspejo = ultimo.exactos + ultimo.cortos + ultimo.pasados;
const pctExactos = totEspejo > 0 ? Math.round((ultimo.exactos / (totEspejo + ultimo.noEstanEnApp)) * 100) : null;
const edad = diasEntreYmd(ultimo.fecha, d.hoy);   // YMD vs YMD, NO new Date("YYYY-MM-DD") (rueda un día en UY)
const estadoEspejo = pctExactos === null ? "neutro"
  : edad > 14 ? "neutro"
  : pctExactos >= 90 ? "ok" : pctExactos >= 80 ? "atencion" : "critico";
```
con `valor = pctExactos === null ? "sin medir" : \`${pctExactos}% exactos\`` y el `sub` mostrando **la plata y la edad**: `medido hace ${edad} d · ${UYU(montoPasados)} de más (215) · ${UYU(montoCortos)} de menos (15) · 42 sin cargar`.

**NO** poner un umbral absoluto en pesos: los $3,24M son **stock heredado del 17-08** (el propio pendiente `pasados-215` lo dice) y dejarían el tile en rojo permanente hasta que Mauricio decida — el mismo error que `tablero-qa.mjs:182-189` documenta como corregido. Si el color debe reaccionar a plata, que sea a `montoCortos` (lo que a la app le FALTA, $6.343) o al **crecimiento contra el empalme anterior**.

**Corregir la fila 04-08** con los datos del log commiteado, y agregar el guardián que faltaba (es un dato curado: lo tiene que cazar CI, no el ojo):
```ts
it.each(EMPALMES)("el espejo de %s cuadra", (e) => {
  const tot = e.exactos + e.cortos + e.pasados; if (tot === 0) return;
  expect(tot + e.noEstanEnApp).toBe(e.activosDisapp);
});
```

**Cubre:** "semáforo por % de filas tapa $3,24M", "verde con $3,24M / rojo si no se midió", "los datos curados no caducan", "la fila 08-04 es imposible".

---

## TANDA 3 — Rótulos y superficie (baratos, no urgentes)

### C1. Adopción: numerador y denominador son poblaciones distintas
**Causa raíz:** el denominador son los **52 cobradores activos de toda la empresa**; el piloto es Zona Centro (**19**). Medido: el 100% de los pagos nativos de 30 días sale de Zona Centro; 0 de los 33 restantes cambió siquiera la clave provisoria. La adopción real es **16/19 = 84%**, el panel muestra 31% (dilución 2,7×), y la tabla pinta **50 de 52 filas en rojo** con "se resuelve acompañando" — consejo falso para 33 personas a las que nunca se les entregó la app. Es la trampa que `operacion.ts:58-67` documenta ("una alarma que suena para el 98% enseña a ignorarla").

**Archivos:** `lib/piloto/alcance.ts` (nuevo, `ZONAS_PILOTO = ["Zona Centro"]`), `lib/data/piloto.ts`, `page.tsx:148,154,176,193`, **y `supabase/migrations/0158`** (repite el mismo denominador: si se cablea sin corregir, el 52 vuelve por la puerta de atrás).

**Arreglo:** marcar cada fila con `enPiloto` (no filtrar: los 33 de afuera tienen 1.356 créditos vivos que nadie toca por la app — es "cartera sin cargar", otro problema). Rojo sólo para los del piloto, gris para el resto, y el rótulo **dice el denominador**: "1 de 19 del piloto (Zona Centro) · 33 fuera, nunca entraron". Yapa de 2 líneas: filtrar el numerador con el mismo set de ids (hoy un cobro de oficina de `pagosPanel.ts` sumaría arriba sin fila abajo — latente, 0 casos en 4.533 pagos).

**Cubre:** "adopción contra los 52 de toda la empresa" + "el numerador no filtra rol".

---

### C2. El candado nunca llega al feed: se lo busca en la tabla equivocada
**Causa raíz:** `enVivo.ts:172` lee `accion.startsWith("Candado")` de **bitácora**, pero los candados se escriben en **auditoría** (`actions.ts:407,484`; `cobradorCredito.ts:428,678`). Verificado: `select count(*) from bitacora where accion like 'Candado%'` = **0**. Los 7 valores que se escriben en bitácora son snake_case fijos.

**Efecto:** los 4 candados históricos (3 en los últimos 20 días) entran como `tipo:"gestion"` 🧾 con `alerta:false` → nunca se encienden el 🔒, el fondo rojo ni el chip "⚠ Alertas (N)". Ese chip es un **contador**, o sea una afirmación de completitud: dice 0 alertas el día que el candado frenó un doble cobro real. Y `clasificar.ts:68` documenta el candado como caso de alerta.

**Arreglo (en `enVivo.ts`, no en `actividad.ts`):** `TipoActividad` es una unión cerrada consumida por `/admin/auditoria` con un `Record` exhaustivo; `ItemFeed.tipo` es `string` libre. En el map de `feedHechos`:
```ts
const esCandado = (e) => e.tipo === "gestion" && e.titulo.startsWith("Candado");
tipo: esCandado(e) ? "candado" : e.tipo,
alerta: e.alerta || esCandado(e),
```
Borrar la rama muerta `:172-186` y el `|| startsWith("Candado")` de `:140`. Corregir el encabezado del archivo (línea 10), que promete "bitácora → …candado". Test que fije el rótulo.

---

### C3. Server actions del piloto: la guarda adentro del try y una acción muerta publicada
**Causa raíz:** `requireDev()` funciona **lanzando** `NEXT_REDIRECT` y las tres actions lo llaman dentro del `try`, así que el catch devuelve `{ok:false, error:"NEXT_REDIRECT"}` y `PilotoPendientes.tsx:198` lo pinta crudo en rojo. El repo ya escribió la regla **dos veces** (`auth-actions.ts:10-11`, `pagosPanel.ts:60-62`) y estas 3 líneas son la única violación del repo.

**Arreglo:** subir `const u = await requireDev();` arriba del `try` en las tres, con el comentario del porqué. **No** usar `isRedirectError` de `next/dist/client/components/redirect` — esa ruta no existe en 15.5.22 (es `.../redirect-error`, privada); si se quiere rethrow, `unstable_rethrow` de `next/navigation`.

**Y borrar `editarPendienteAction`** (`actions.ts:74-89` + import de la 9) y `editarPendiente` (`pilotoPendientes.ts:150-164`): cero llamadores en todo el repo, pero **action ID vivo en el manifest** (verificado), y escribe monto/título sin `montoDe` y sin apilar `historial`, al revés de sus dos hermanas. Ajustar `dev/page.tsx:79` ("pendientes editables" → "pendientes con estado y nota"). Cuando haga falta editar de verdad, la plata que cambia se corrige **midiéndola con 0158**, no tipeándola.

**Cubre:** los 2 hallazgos de NEXT_REDIRECT + los 2 de `editarPendienteAction`.

---

### C4. Rótulos que prometen distinto de lo que el código mide (cambios de un string)
Todos en `app/admin/(panel)/piloto/page.tsx` y `EnVivoTablero.tsx`:

| Dónde | Hoy | Debe decir |
|---|---|---|
| `EnVivoTablero.tsx:34` | `"Entraron hoy"` (columna) — colisiona con el KPI del mismo nombre que cuenta ahora+reciente+hoy | `"Más temprano hoy"`. **No** "Entraron y se fueron": el código no observa ninguna salida |
| `piloto/page.tsx:228` | "Jornadas **con cobros** y sin acta" — el helper siembra jornadas de 0 cobros abiertas por una base entregada (el caso que fue construido para mostrar) | "Jornadas **abiertas** sin acta (14 d)". **No** "con plata en la mano" (`esperado` puede ser 0). De paso el `href` debe ir a `/admin/jornada`, donde está el detalle |
| `piloto/page.tsx:156` | "sin acta no hay arrastre: cada uno amanece en $0" — `getBaseDelDia` dice que la base cargada **gana** | "sin acta no arrastra la caja: amanecen en $0 **salvo que el supervisor cargue la base**" (texto que el propio seed 0157 ya tiene bien). **Gemelos en producción:** `cobrador/(app)/page.tsx:222` y `admin/jornada/page.tsx:527` — esos importan más |

**Aparte, `scripts/build-info.mjs`:** `sucio` está clavado en `true` en los 3 commits de su historia, por CSV sin trackear. El arreglo NO es `--untracked-files=no` (un `.tsx` untracked **sí se despliega**: `vercel --prod` sube el working dir, no el commit → falso negativo en la única pregunta que el tile responde). El arreglo es `.gitignore` de `scripts/_*.csv` y `scripts/_*_revert_*.json` (extendiendo el bloque que ya existe) + separar `modificados` de `nuevosSinTrackear` + mostrar `BUILD.generadoEn` (hoy el "hace X" es la edad del **commit**, no del deploy).

---

## Lo que NO vale la pena arreglar

1. **Paginar `pagosQ`/`auditoriaQ` dentro de `getActividad`.** Esa función la comparte `/admin/auditoria` (pantalla del dueño) con rangos de 30 días y `select("*")`; sacarle el tope cambia el costo de una página admin para arreglar un tile dev. El feed está capado a propósito. La plata se saca por consulta propia (B1).
2. **Umbral absoluto en pesos para el tile del espejo.** Los $3,24M son stock heredado sin fuga viva: cualquier tope razonable deja el tile rojo hasta que Mauricio decida qué anular, y un semáforo permanentemente rojo es tan inútil como uno permanentemente verde.
3. **`"en <pantalla>"` en presente** (`EnVivoTablero.tsx:322`). Medido: la mediana entre un hecho y su última navegación es **6 segundos**, el p90 es 0,6 min, y en 30 días **cero** días-persona terminaron con el hecho a más de 10 min de la navegación. Además `RegistroUso` sólo emite al **cambiar** de path, así que un gap grande normalmente significa "sigue ahí". Requiere agregar un campo al payload para casi nunca cambiar nada.
4. **Filtrar el numerador de adopción por rol como tarea propia.** De 4.533 pagos nativos, el 100% lo registró un cobrador activo; nunca se usó `registrarPagoPanel`. Va de yapa en C1, no como ítem.
5. **Paginar `rendiciones`/`aperturas_caja` *por miedo al corte de 1000*.** Techo estructural de 728 por `unique (cobrador_id, fecha)`: harían falta 72 cobradores cerrando caja todos los días. Se paginan igual (B3), pero por el **error tragado**, no por el truncamiento — no vender ese motivo.
6. **`lib/data/promos.ts:159`** (mismo bug de A1: sub-cuenta 47 créditos nativos finalizados que el espejo adoptó, o sea clientes que completaron un ciclo en la app y **no cobraron su raspadita**). El swap es igual de correcto, pero **reparte premios reales**: lo aprueba Carlos, no entra en este commit.
7. **Cablear `editarPendiente` con validación e historial** en vez de borrarla: le da vida a un camino que nadie usa, y `montoDe` devuelve `null` ante un valor inválido — endurecerlo así **borraría la plata del pendiente en silencio**.
8. **Un pendiente auto-generado "anotar el empalme del DD-MM".** `piloto_pendientes` es la agenda de decisiones humanas con historial; un pendiente que se auto-crea y auto-resuelve ensucia el historial y el contador de abiertos. Con el sub "medido hace N d" alcanza.

---

**Deuda preexistente que este trabajo destapa** (fuera del commit auditado, pero ya miente HOY): `lib/data/uso.ts:212` cuenta acciones de auditoría con `.limit(20000)` sin paginar — con 880 filas en un día ese contador de `/admin/uso` ya está truncado; y `uso.ts:162` / `actividad.ts:349` calculan plata de hoy con `.limit(10000)` / `.limit(2000)`, o sea el mismo techo real de 1.000 con el pico medido en 465.
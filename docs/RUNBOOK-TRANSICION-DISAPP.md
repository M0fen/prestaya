# RUNBOOK — Transición ordenada Disapp → Presta Ya (coexistencia)

> **Qué es esto.** El plan para correr **Presta Ya y Disapp en paralelo** durante la
> transición, sin perder ni duplicar plata, y para saber **cuándo apagar Disapp** con
> datos, no a ojo. Incluye el **punto de referencia (baseline T0)** que ancla todo.
>
> Basado en una investigación a fondo (mapeo del empalme actual + mejores prácticas de
> _parallel run_, reconciliación financiera y _cutover_ por fases). Léelo completo antes
> de arrancar la coexistencia en una zona nueva.

---

## 0. Resumen ejecutivo (la estrategia en 6 líneas)

1. **Nunca big-bang.** Se migra **zona por zona** (strangler-fig). El piloto de **Zona
   Centro** ya es el _canary_. Sur y Norte son olas siguientes.
2. **Una zona = un solo sistema autoritativo a la vez.** Mientras Disapp mande, los cobros
   en la app son un **reflejo**; cuando la app mande, Disapp queda de respaldo.
3. **El cobrador captura el cobro UNA sola vez** (en la app, en la zona piloto). Jamás
   re-tipea el mismo pago en los dos lados (eso es doble-cobro o plata perdida).
4. **Punto de referencia (T0):** al arrancar cada zona se **congela una foto inmutable**
   del estado por crédito. Todo _drift_ se mide contra ese ancla, no contra un Disapp que
   se sigue moviendo.
5. **Reconciliación diaria** de dos vías (app ↔ Disapp) sobre el **PAGADO por crédito**
   (dato duro comparable), con un registro de diferencias (_breaks_) que envejece.
6. **Se corta Disapp de una zona sólo al cumplir criterios numéricos escritos** (no "parece
   que cuadra"). Con _hypercare_ y plan de reversa.

---

## 1. Principios de oro (no se negocian)

| # | Principio | Por qué |
|---|-----------|---------|
| P1 | **Golden source: un solo sistema es autoridad de cada dato en cada momento.** | El _dual-write_ (escribir el mismo cobro en dos lados) es el pecado capital: doble-cobro o pérdida + ambigüedad de "quién manda". |
| P2 | **Sync SIEMPRE de una vía** (Disapp → Presta Ya) hasta el corte de la zona. | Bidireccional = _split-brain_ (el mismo crédito con datos distintos en cada lado). |
| P3 | **Una zona = un solo sistema autoritativo.** | La partición por zona (RLS ya existente) es justo lo que evita cobrar el mismo crédito en ambos lados. |
| P4 | **Reconciliar sobre el PAGADO acumulado, nunca sobre la CARTERA.** | Nuestro saldo = `cuota_diaria × total_dias`; el de Disapp lleva intereses. El gap de cartera es diferencia de **modelo**, NO plata perdida. El `pagado` sí es comparable directo (tolerancia 0). |
| P5 | **NUNCA correr `empalme_disapp.py --commit` sobre la base viva.** | Re-siembra ajustes inmutables y re-infla la cartera ya reconciliada. Para incrementales: sólo el camino insert-only / delta reversible (ver §7 y §10). |
| P6 | **El cobrador nunca hace trabajo de reconciliación.** | La doble-carga y la fatiga son el riesgo humano #1 del _parallel run_. Los _breaks_ los resuelve el supervisor/admin sobre el registro. |
| P7 | **Todo ajuste de empalme se fecha en la fecha del hecho** (fecha_inicio del crédito o del snapshot de Disapp), **nunca "hoy".** | Para no inflar "recaudado hoy/mes" con plata vieja. |

---

## 2. El PUNTO DE REFERENCIA (baseline T0) — el ancla de toda la transición

**Qué es.** Una **foto congelada e inmutable** del estado exacto en el instante en que una
zona arranca el _parallel run_. Contra ella se mide **toda** divergencia futura y es el
estado al que se **vuelve** en un rollback. Hoy NO existe (el `shadow-disapp.py` compara
contra el export *de cada día*, no contra un T0 fijo; la "línea base" del runbook viejo es
texto en markdown, no una foto consultable).

**Qué congela** (por crédito, ambas fuentes el mismo día):

- **Lado app:** `prestamo_id`, `disapp_credit_id/ref`, `cliente_id`, `cobrador_id`,
  `zona_id`, `estado`, `cuota_diaria`, `total_dias`, `total_a_pagar`, **`pagado_acum`**,
  `saldo`, `ultimo_pago_en`, `n_pagos`.
- **Lado Disapp** (del export del día del corte): **`disapp_pagos`** (columna "Pagos"),
  `disapp_saldo` (informativo), y el **nombre + timestamp del archivo** usado.
- **Totales de control** por zona/cobrador: nº de créditos, Σ cartera, Σ pagado, nº de
  clientes (los mismos totales que usa la reconciliación financiera).

**Cómo se implementa** (ver §11 y la migración `0091`):

- Tabla `snapshot_credito` **append-only e inmutable** (RLS: lectura gestor, insert sólo
  service_role, sin update/delete — igual que `reconciliacion_log` 0073), versionada por
  `label` (`t0-centro-2026-08-01`, `t0-sur-…`, etc.). Permite varios cortes.
- Tabla compañera `snapshot_totales` para el corte por zona/cobrador que revisás vos.
- Script `snapshot-baseline.mjs` (captura T0 de la base viva + el `creditos_*.xlsx` del día)
  y `divergencia-vs-baseline.mjs` (mide app-HOY contra el T0 congelado).

**Para qué sirve concretamente:**

- Distinguir **"diferencia que ya existía en el baseline"** de **"drift nuevo del paralelo"**.
- Medir la **racha de días en sync** (criterio para que la app "gane" autoridad).
- Tener un **estado firmado al cual revertir** si el corte sale mal.

> 📌 El primer registro real es el `label = t0-centro` de Zona Centro. Convertir la "línea
> base del dinero" del runbook viejo en ese primer snapshot consultable.

---

## 3. Las 6 fases del cutover (por zona)

Cada zona recorre estas fases **de forma independiente**. Hoy **Zona Centro está en Fase 1**.

| Fase | Nombre | Autoridad | Qué pasa | Cómo se sale |
|------|--------|-----------|----------|--------------|
| **0** | **Baseline T0** | Disapp | Se congela el snapshot T0 de la zona (§2) + se archiva el export de Disapp de ese día. | Snapshot capturado y reconciliado contra Disapp. |
| **1** | **Reflejo** | **Disapp** | Disapp autoritativo. La app **importa** (una vía, insert-only/delta) y **reconcilia a diario**. Los cobradores pueden usar la app para *ver/ensayar*, pero la verdad es Disapp. | Adopción de cobradores ≥ umbral + reconciliación diaria estable. |
| **2** | **Cobro en la app (controlado)** | **App** | La zona **cobra en Presta Ya** (captura única). Se sigue reconciliando vs Disapp como respaldo. Disapp se alimenta desde la app por export/import, **el cobrador no re-tipea**. | Cumplir los **criterios go/no-go** de §8 (N días en sync, 0 críticos, rollback ensayado). |
| **3** | **Corte de la zona** | App | **Freeze** en Disapp: fecha anunciada, último día de cobro en Disapp, import final idempotente, `shadow` EN SYNC, **flip** a Presta Ya autoritativo. | 48-72 h de **hypercare** sin incidentes. |
| **4** | **Siguiente zona** | — | Repetir Fase 0→3 con Sur, luego Norte. Se puede **revertir una ola** si diverge. | Todas las zonas cortadas. |
| **5** | **Decomisión de Disapp** | App | Sólo cuando **TODAS** las zonas están cortadas y estables N días. Archivar baseline + exports finales (**retención legal, Ley 18.331**). Apagar planillas/reportes paralelos en **fecha definida con dueño**. | Fin del legado. |

> **Regla de secuencia dentro de la zona** (cohortes de loan servicing): dentro de una zona,
> priorizar **al-día → vencidos → cerrados**. Y capacidad de **revertir una ola** si una
> cohorte diverge.

---

## 4. Fuente de la verdad por dato (quién origina qué, en cada fase)

El error más caro es que el **mismo hecho** entre por dos caminos con dos llaves que no se
cruzan. Regla por tipo de dato:

| Dato | Fase 1 (Reflejo) | Fase 2-3 (App autoritativa) |
|------|------------------|------------------------------|
| **Cobro/pago** | Lo crea **Disapp**; la app lo **importa** (delta por crédito). | Lo crea **la app** (captura única del cobrador). Disapp se alimenta por export. **Nunca los dos.** |
| **Crédito nuevo** | Lo crea **Disapp**; la app lo importa (con `disapp_credit_id`). | Puede nacer en la app (`renovar_credito_seguro`). ⚠️ Si nace en la app **no tiene** `disapp_credit_id` → un import posterior lo **duplicaría**. Ver §10. |
| **Cliente nuevo** | **Disapp** (o alta de oficina con match por documento). | App. Mismo cuidado: sin `disapp_id`, un import lo duplica. |
| **Refinanciación** | Disapp; el import **finaliza el viejo** (regla del crédito más nuevo por cliente+modalidad). | App (`0087`, atómico: finaliza+inserta). |

**Decisión pendiente (fijar por escrito, por zona):** en Fase 2, **¿se permite originar
créditos/clientes nuevos en la app, o siguen naciendo en Disapp?** Si se permite en la app,
hace falta un **paso de match-before-import** (por documento del cliente; por
cliente+fecha+monto+cuota del crédito) para que el import no re-cree lo nacido en la app.

---

## 5. Facilitación por rol (mínima fricción durante la coexistencia)

El objetivo: que la transición **no le sume trabajo manual a nadie**, sobre todo al cobrador.

### 👣 Cobrador (en la calle)
- **Captura ÚNICA:** cobra en **un solo** sistema según la fase de su zona. En Fase 1 sigue
  como siempre (Disapp); a partir de Fase 2, **sólo en la app**. **Jamás en los dos.**
- La app ya es **offline-first** (cola no-desalojable, cierre de jornada que cuadra) → no
  necesita señal para cobrar; sincroniza sola.
- **No hace reconciliación.** Si hay una diferencia, la resuelve la oficina.
- **Señal clara en el cartón:** que el cobrador vea de un vistazo si un cliente **ya está en
  la app** (autoritativo) o **sigue en Disapp** (no cobrar acá todavía). *(mejora sugerida,
  §12)*

### 🧭 Supervisor (dueño de la zona)
- Es el **dueño de los _breaks_ de su zona**: revisa a diario las diferencias vs Disapp que
  el sistema le marca (acotadas a su zona por RLS), y las resuelve/deriva.
- Ve su reconciliación en **Mi jornada** + el registro de breaks (§7).
- Aprueba lo operativo de su zona; **el admin corta la zona**.

### 👑 Admin (dueño del negocio)
- **Decide el corte de cada zona** con los criterios de §8 en la mano (en `/admin/empalme`).
- Corre (o supervisa) la reconciliación diaria, el snapshot T0, y tiene el **kill switch** a
  mano en el corte.
- Único que puede correr los scripts de import/sync (§11).

---

## 6. Qué YA tenés bien (no romper)

- **Sync una-vía idempotente:** `import-recaudos-recientes.py` inserta recaudos de Disapp
  por `disapp_pago_id` (insert-only, re-correr = 0 filas nuevas).
- **Llaves de correlación:** `disapp_credit_ref`/`disapp_pago_id` + idempotencia (23505 =
  éxito). Es exactamente lo que pide la industria. **Mantener SIEMPRE la llave en cada fila
  importada.**
- **Reconciliación interna:** invariantes puras (`pagado_acum == Σpagos`, sin sobre-cobro)
  en `lib/reconciliacion.ts` + RPC `0071` (agrega en SQL, no trae 162k pagos) + cron 07:00 +
  log `0073` + panel `/admin/empalme` + kill switch `0072`.
- **Comparación vs Disapp:** `shadow-disapp.py` diffea el **pagado** por crédito (comparable
  directo) y clasifica "atrás" (nos faltan recaudos, esperable) vs "adelante" (tenemos más,
  a investigar).
- **Gotchas de dinero ya resueltos** en el parseo: plata ×1000, texto uruguayo, mediodía UY,
  `order=id` estable. **No tocar.**

---

## 7. Reconciliación durante la coexistencia (lo que hay que agregar)

La reconciliación de HOY valida sobre todo la **consistencia interna** de la app. Para
semanas de coexistencia falta el **break management de dos vías**:

1. **Reconciliación BIDIRECCIONAL:** además de app→Disapp, recorrer los refs de **Disapp**
   para detectar créditos/pagos que están en Disapp y **faltan en la app** (import perdido).
   Reportar ambas direcciones como _breaks_ separados. *(hoy el shadow es casi de una vía)*
2. **Registro de BREAKS con aging:** una tabla `conciliacion_disapp` (o reciclar `0073`) por
   crédito: `disapp_credit_ref`, `pagado_app`, `pagado_disapp`, `diferencia`, `direccion`
   (atras/adelante/solo_app/solo_disapp), `clasificacion` (nuevo_app_esperado | drift_real |
   refi_sospechado | modelo), `estado` (abierto→investigando→casado→resuelto), `dueño`
   (supervisor de zona), `abierto_en` (para que los breaks viejos **salgan a la superficie**).
3. **Matching en capas:** capa 1 = match exacto por `disapp_credit_ref`; capa 2 =
   cliente+monto+fecha aproximada (levanta parte de los "sin match" solo); el resto → **cola
   manual** en el panel, no a `/dev/null`.
4. **Clasificar el pago app-nativo nuevo** (timestamp posterior al export de Disapp = actividad
   correcta, "adelante" esperado) del **drift real**. Que el veredicto **escale por diferencia
   MATERIAL por crédito**, no por un umbral % global (que puede enmascarar un sobre-cobro de un
   solo crédito en cartera grande).
5. **Huérfanos (INV4) al camino automatizado:** hoy solo el `.mjs` manual detecta pagos
   huérfanos; agregarlo al cron para que no queden pagos colgados durante la coexistencia.
6. **Panel `/admin/empalme` → pestaña "vs Disapp":** breaks abiertos, aging, matcheados/
   sin-match por lado, tendencia de la racha en sync — leyendo la tabla de breaks.

---

## 8. Criterios go/no-go para CORTAR Disapp (por zona) — cuantitativos

> El _pitfall_ #1 del parallel run es **no fijar fecha de salida**: se terminan operando dos
> sistemas para siempre. Estos umbrales se escriben **antes** de arrancar la zona y viven en
> `/admin/empalme`.

Se corta Disapp de una zona **sólo si TODO esto es cierto**:

- [ ] **≥ 10 días hábiles consecutivos** con `shadow-disapp` **"adelante material = 0"**
      (medido por **PAGADO**, no por cartera).
- [ ] **0 críticos** en la reconciliación interna (`pagado_acum == Σpagos`, sin sobre-cobro).
- [ ] **0 breaks abiertos > 3 días** en la tabla de breaks de esa zona.
- [ ] **Adopción de cobradores ≥ umbral** (medible con `eventos_uso`, migración 0064).
- [ ] **Baseline T0 de la zona reconciliado** contra Disapp.
- [ ] **Rollback ensayado** al menos una vez.
- [ ] **Fecha tope** definida (aunque falten días, hay una fecha límite para decidir).

---

## 9. El corte (freeze + flip) y la reversa

**Procedimiento de corte de una zona (Fase 3):**

1. **Anunciar** la fecha de corte al equipo de la zona.
2. **Último día de cobro en Disapp** para esa zona → a partir de ahí, **dejar de cobrar en
   Disapp** ahí.
3. **Import final idempotente** de los últimos recaudos de Disapp de esa zona (delta por
   crédito, nunca `--commit` masivo).
4. **Verificar `shadow-disapp` EN SYNC** (0 "adelante" material).
5. **Flip:** la zona pasa a **Presta Ya autoritativo**.
6. **Hypercare 48-72 h:** reconciliación **2×/día**, responsable de guardia, **kill switch a
   mano**. Monitorear: posteo de pagos, clasificación En mora vs Cartera vencida, doble-cobro.

**Plan de reversa (decidir ANTES del primer corte):**

- En Fase 1 el rollback es trivial: dejar de usar la app; Disapp nunca perdió la verdad.
- Tras el flip, si algo falla en 48-72 h: **volver a cobrar en Disapp** (que conserva el
  baseline + los últimos imports). Por eso Disapp queda de **respaldo read-only** hasta que
  la zona esté estable, no se apaga en el acto.

---

## 10. Landmines y gotchas conocidos (leer sí o sí)

| ⚠️ | Landmine | Regla |
|----|----------|-------|
| 1 | **`import-recaudos-recientes.py` (import por-pago) DUPLICA plata en una zona ya viva en la app.** No hay llave que cruce un cobro app (`op_id`) con un ID Pago de Disapp (`disapp_pago_id`) → se inserta doble → `pagado_acum` inflado. | En una zona que **ya cobra en la app**, usar **SÓLO el método DELTA por crédito** (`sincronizar-zona-centro.mjs`: delta = Disapp − nuestro, capado al total, idempotente `recon-zc-<id>`, reversible). El import por-pago sólo para zonas **aún en Disapp**. |
| 2 | **Créditos/clientes nacidos en la app no tienen llave Disapp** → un import posterior los **re-crea duplicados**. | Match-before-import por documento (cliente) y cliente+fecha+monto+cuota (crédito) antes de crear. Fijar quién origina cada entidad por zona (§4). |
| 3 | **`creditos_*.xlsx` crudo suma ~$94-126M** vs los **$68,5M autoritativos** → **refis 0% doble-contadas** ($25,76M / 341 créditos). | **NO importar el crudo.** Regla del **crédito más nuevo por (cliente, modalidad)**; finalizar el viejo antes de crear el nuevo. |
| 4 | **`empalme_disapp.py --commit`** re-siembra ajustes inmutables + re-infla la cartera reconciliada. | **NUNCA** sobre la base viva. Sólo insert-only/delta. |
| 5 | **Paginar el REST sin `order=id`** es inestable (una vez subestimó 626/919 pagos). | Todo fetch pagina con `order=id.asc`. |
| 6 | **La plata de Disapp viene ×1000** en recaudos (separador de miles comido). | Ya resuelto en `parse_recaudo`; no tocar. |
| 7 | **`disapp_pago_id` mezcla 4 convenciones** en un solo campo: `ID Pago` crudo · `ajuste-<cid>-<dia>` · `recon-zc-<cid>` · `recon-0715-<ref>`. La idempotencia vive en el **nombre**. | Documentado. **Ningún script futuro cambia la convención** (re-sembraría plata). |
| 8 | **`pagos.origen` NO distingue app vs disapp** (los cobros nativos lo dejan `NULL`). | Mejora sugerida (§12): poblar `origen='app'` en el camino nativo para un discriminador fiable. Hoy se infiere por `op_id != null / disapp_pago_id == null`. |

---

## 11. Herramientas (qué correr — y qué NUNCA)

**Punto de referencia (nuevo, ver §12):**
- `node scripts/snapshot-baseline.mjs --label t0-centro --src <creditos_*.xlsx>` → captura T0
  (DRY-RUN por defecto; `--commit` para persistir). **Read-only sobre la plata** (solo escribe
  la tabla de snapshot).
- `node scripts/divergencia-vs-baseline.mjs --label t0-centro` → app-HOY vs T0 (Δpagado/Δsaldo
  por crédito, nuevos/finalizados desde T0, por zona).

**Coexistencia (existentes):**
- ✅ `import-recaudos-recientes.py --desde <fecha>` — incremental insert-only, **sólo zonas aún
  en Disapp**.
- ✅ `sincronizar-zona-centro.mjs` / `importar-creditos-zona-centro.mjs` — delta reversible
  (DRY-RUN por defecto, `--commit`, `--revertir`). Para zonas ya vivas en la app.
- ✅ `shadow-disapp.py` — diff diario app vs export fresco (read-only).
- ✅ `reconciliacion.mjs` + cron `0071` — invariantes internas (guardia permanente).
- ❌ `empalme_disapp.py --commit` — **NUNCA sobre la base viva** (§10.4).

> **Fragilidad a arreglar:** los 5 scripts de Zona Centro _hardcodean_ el export
> `creditos_2026-07-22_02-55.xlsx` con ruta relativa → tiran `ENOENT`. **Parametrizar `--src`
> y resolver contra `C:\Users\Carlos\migracion`, tomando el `creditos_*.xlsx` más nuevo por
> default** (como ya hace `shadow-disapp.py`).

---

## 12. Mejoras recomendadas (backlog de la transición, por prioridad)

| Prioridad | Mejora | Nota |
|-----------|--------|------|
| 🔴 alta | **Snapshot T0** (tablas + scripts) — el punto de referencia. | Migración `0091` (Carlos la corre) + `snapshot-baseline.mjs` / `divergencia-vs-baseline.mjs`. **Entregado con este runbook.** |
| 🔴 alta | **Registro de breaks vs Disapp con aging** + pestaña "vs Disapp" en `/admin/empalme`. | §7. Es lo que falta para break management real. |
| 🔴 alta | **Criterios go/no-go en `/admin/empalme`** (los de §8, medibles). | Convierte "cortar Disapp" en una decisión con datos. |
| 🟡 media | **`shadow-disapp.py` bidireccional** (recorrer refs de Disapp ausentes en la app). | §7.1 |
| 🟡 media | **Poblar `pagos.origen='app'`** en el camino nativo (RPC `0079` + `insertarPagoPlano`). | Discriminador fiable app vs disapp. La parte del RPC es DDL (Carlos). |
| 🟡 media | **Huérfanos (INV4) al cron** de reconciliación. | Hoy solo el `.mjs` manual. |
| 🟡 media | **Parametrizar `--src`** en los 5 scripts de Zona Centro. | §11 (evita ENOENT al reusarlos). |
| 🟢 baja | **FK de linaje de refi** (`prestamos.renovado_de`) para reemplazar el cierre-por-ausencia. | Reduce heurística. |
| 🟢 baja | **Señal en el cartón del cobrador** "ya en la app" vs "sigue en Disapp". | Facilitación de rol (§5). |

---

## 13. Checklist de arranque de una zona nueva (imprimible)

**Antes (Fase 0):**
- [ ] Zona armada (cobradores con ruta, supervisor 1:1) — `scripts/armar-zona.mjs`.
- [ ] Export de Disapp del día archivado (`creditos_*.xlsx`).
- [ ] **Snapshot T0 capturado** (`snapshot-baseline.mjs --commit`) y reconciliado.
- [ ] Criterios go/no-go de la zona **escritos**.

**Durante Fase 1-2:**
- [ ] `shadow-disapp.py` corre **todos los días** y **alguien lee el veredicto**.
- [ ] Reconciliación interna (cron `0071`) verde.
- [ ] Breaks revisados a diario por el **supervisor de la zona**.
- [ ] Cobradores cobran en **un solo** sistema (captura única).

**Corte (Fase 3):**
- [ ] Fecha anunciada + último día en Disapp.
- [ ] Import final idempotente + `shadow` EN SYNC.
- [ ] Flip a Presta Ya autoritativo.
- [ ] Hypercare 48-72 h (recon 2×/día, guardia, kill switch a mano).

**Post:**
- [ ] Zona estable N días → siguiente ola.
- [ ] Disapp de la zona en read-only (respaldo) hasta decomisión global.

---

*Documento vivo. Actualizar a medida que se corta cada zona. Referencia técnica: migraciones
0036 (llaves Disapp), 0041 (paridad), 0071/0073 (reconciliación), 0072 (kill switch), 0091
(snapshot T0). Investigación fuente: workflow `empalme-transicion-disapp` (07-28).*

# MASTER PROMPT — Script de importación Disapp → Presta Ya (empalme)

> Pegá este prompt en Claude Code, abierto en el repo de Presta Ya.
> Está escrito desde la ESTRUCTURA real de los datos (columnas verificadas), no desde
> los datos reales. VOS corrés el script contra tu propia máquina y tu Supabase.
> Claude Code nunca ve datos sensibles (Ley 18.331 Uruguay): solo escribe el script.
>
> **Carpeta de datos (en mi máquina Windows):** `C:\Users\Carlos\migracion`
> Todos los .xlsx exportados de Disapp están ahí. El script lee esa carpeta entera.

---

## Objetivo

Escribime un **script de importación idempotente y auditable** que:
1. Lea TODOS los exports de Disapp desde `C:\Users\Carlos\migracion`.
2. Los consolide y deduplique en memoria.
3. Me diga qué rango de fechas está cubierto y **qué días faltan** (auditoría).
4. Cargue clientes, créditos y pagos en Presta Ya (Supabase/PostgreSQL), primero en
   PRUEBA, con validación, y recién después en producción.

## Reglas duras (no negociables)

1. **Idempotencia total.** Correr el script 2 veces no duplica nada.
   - Clientes: llave externa = **`ID` de Disapp** (columna `ID` del export de clientes) → `disapp_id`. `UPSERT` por esa llave. **OJO: el documento NO es único** (hay 13.027 clientes pero solo ~11.490 documentos distintos: hay documentos repetidos o vacíos). Usar SIEMPRE el `ID` de Disapp como llave del cliente, nunca el documento.
   - Créditos: llave externa = **`ID Crédito`** de Disapp → `disapp_credit_id`. `UPSERT` por esa llave. (La referencia tipo `PRD00032...` también es única y sirve de respaldo.)
   - Pagos: llave externa = **`ID Pago`** de Disapp. Insert idempotente; si ya existe, se ignora.
2. **Pagos inmutables.** Presta Ya trata los pagos como registros inmutables con auditoría. Insertá por un camino de importación explícito (`source='disapp_import'` + `imported_at`), respetando los triggers/constraints de auditoría existentes. Nunca DELETE; anulación solo por el flujo normal (quién/cuándo/porqué).
3. **Dry-run por defecto.** Arranca en `--dry-run`: reporta qué haría y NO escribe. Solo escribe con `--commit` explícito.
4. **Entorno por variable.** Nunca hardcodear credenciales. Leer `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de `.env`. **Abortar si la URL parece producción** salvo flag `--prod` deliberado.
5. **Filas footer.** Los exports traen filas de totales al final (con la llave vacía): descartar toda fila con llave nula/vacía antes de procesar.
6. **Fechas** en formato `dd/mm/yyyy` (uruguayo): parsear con día primero.
7. **Precisión monetaria.** Montos con decimales y locale uruguayo (**coma decimal**). Parsear bien la coma y guardar en `NUMERIC`/decimal — **nunca `float`**. Respetá el tipo real de la columna en el esquema.
8. **`Saldo Pendiente` de Disapp = foto de un momento, NO la verdad.** Presta Ya calcula su propio saldo desde los pagos. Importá el hecho del pago (monto, fecha, crédito, cobrador); **no pises** el saldo calculado con el snapshot de Disapp. Guardalo como metadato de referencia si querés, nunca como fuente de saldo.

## Paso 0 — ANTES de escribir el importador (esperá mi OK)

1. Leé las migraciones en `supabase/migrations` y mapeá las tablas reales de destino (clientes, créditos, pagos, zonas, cobradores/vendedores, supervisores). **No inventes nombres de columnas.**
2. Verificá si existen columnas de ID externo (`disapp_id`, `disapp_credit_id`, y un ID externo de pago). Si no existen, generá una migración que las agregue con índice único. Índice único obligatorio sobre el ID externo de pago.
3. Mostrame un **mapeo propuesto** (columna Disapp → columna Presta Ya) para clientes, créditos y pagos. **Esperá mi OK** antes de escribir el importador.
4. **Mapeo de cobradores + supervisores.** El campo `Vendedor` es texto libre. Sacá la lista de vendedores distintos y proponé el match contra los cobradores existentes (por nombre normalizado). Generá un reporte de **vendedores sin match** para que yo los mapee a mano. Los pagos con vendedor sin match se importan igual, marcados para revisión — nunca se descartan.
   - **Casos especiales:** algunos "vendedores" NO son cobradores de calle sino supervisores de zona, y aparecen así: `SUPERVISOR ZONA SUR, CESAR`, `SUPERVISOR ZONA CENTRO, BOSO`, `SUPERVISOR EDWIN, URUGUAY`. Sus "créditos" son montos enormes (ej. $700.000–$1.650.000, cuotas de $21.000–$50.000) porque representan la relación supervisor↔cobrador, no un préstamo a un cliente final. Tratalos como una categoría aparte (ej. `tipo='supervisor'`) para que NO distorsionen las estadísticas de cobradores ni la mora de clientes reales. Proponeme cómo modelarlos y esperá mi OK.

## Fuentes en `C:\Users\Carlos\migracion` (columnas reales verificadas)

El script debe **auto-descubrir** por prefijo de nombre y unir todos los que encuentre (puede haber múltiples y hasta copias con sufijos tipo ` - copia`, `__1_`; deduplicar por la llave correspondiente).

### `clientes_*.xlsx` — 13.027 clientes, **17 columnas**
`ID` · `Documento` · `Nombre` · `Género` · `Teléfono` · `Email` · `Ciudad` · `Dirección` · `Dirección Alternativa` · `Latitud` · `Longitud` · `Vendedor` · `Ruta` · `Estado` · `Observación` · `Fecha Creación` · `Fecha Actualización`
- Llave: `ID`. Enganche de cobrador por `Vendedor`/`Ruta`. Hay `Latitud`/`Longitud` (útiles para el GPS/ruta de Presta Ya).

### `creditos_*.xlsx` — ~2.748 créditos ACTIVOS, **28 columnas**
`ID Crédito` · `Crédito #` · `Tipo Producto` · `ID Vendedor` · `ID Cliente` · `Cliente` · `Documento` · `Teléfono` · `Vendedor` · `Modalidad` · `Valor Crédito` · `Total c/ Intereses` · `Tasa %` · `Cuotas` · `Valor Cuota` · `Cuota Pactada` · `Pagos` · `Saldo Pendiente` · `Cuotas Pend.` · `Fecha Crédito` · `Estado` · `Observación` · `Ref. Nombre` · `Ref. Dirección` · `Ref. Teléfono` · `Penalidad` · `Penalidad Cobrada` · `Penalidad Perdonada`
- Llave: `ID Crédito`. Engancha a cliente por `ID Cliente`. Modalidad: Diaria/Semanal/Quincenal/Mensual/Personalizado.
- **Este export trae solo créditos ACTIVOS (~2.748).** Ver la nota crítica de "créditos huérfanos" abajo.

### `recaudos_*.xlsx` — histórico de pagos (1 fila = 1 pago), **13 columnas**
`ID Pago` · `Ref. Crédito` · `Vendedor` · `Cliente` · `Documento` · `Teléfono` · `Total Crédito` · `Valor Cuota` · `Recaudo` · `Saldo Pendiente` · `Cuota #` · `Total Cuotas` · `Fecha Pago`
- `ID Pago`: llave de idempotencia. `Ref. Crédito`: engancha al crédito (`PRD...`). `Recaudo`: monto (UYU). `Fecha Pago`: dd/mm/yyyy.

### PDFs de referencia (NO se importan, son para validar a mano)
`Ventas_en_Mora_*.pdf` (1.364 créditos en mora; totales venta+utilidad $54.704.667 y mora $13.540.884) y `Cartera_por_Cliente_*.pdf`. Sirven para cotejar mora y estructura de zonas/supervisores, no para cargar.

## NOTA CRÍTICA — créditos huérfanos (decisión de diseño, preguntame)

El export de créditos trae ~2.748 (solo activos), pero los pagos referencian **~8.726 créditos distintos** (incluye créditos viejos ya cerrados que ya no están en el export activo). Entonces la mayoría de los pagos históricos van a apuntar a un crédito que NO existe en la tabla de créditos.

Opciones (proponeme una y esperá mi OK, no asumas):
- (A) Crear un **stub de crédito** por cada `Ref. Crédito` referenciada por pagos pero ausente del export, con estado `cerrado/histórico`, para no perder el enganche.
- (B) Importar esos pagos con `credito_id = null` + `disapp_credit_ref` guardada, y reconciliar después.
- Lo que NO se hace: descartar pagos huérfanos.

## Orden de importación

1. **Clientes** (`UPSERT` por `ID` Disapp).
2. **Créditos** activos (`UPSERT` por `ID Crédito`; enganchan a cliente por `ID Cliente`).
3. (según decisión de huérfanos) **stubs de créditos históricos** desde las `Ref. Crédito` de pagos sin crédito activo.
4. **Pagos** (idempotente por `ID Pago`; enganchan por `Ref. Crédito`; vendedor→cobrador).

## Modo auditoría (OBLIGATORIO) — `--audit`

Antes de importar, un modo que lee la carpeta y me imprime **sin tocar la DB**:
- Total de pagos únicos, rango de fechas, y **cobertura día por día**.
- Qué días hábiles faltan. **Regla:** los **domingos casi no tienen cobro** (ignoralos); marcá como hueco real solo días hábiles (lun–sáb) sin ningún pago. Feriados (ej. 1-ene) pueden aparecer vacíos legítimamente: listalos aparte como "posible feriado".
- Conteo y suma de `Recaudo` **por día y por mes**.
- Lista de `Vendedor` distintos (para el mapeo de cobradores/supervisores).

> Estado conocido al momento de armar esto (verificalo con `--audit`): 2026 está completo ene→may EXCEPTO **mayo 28–31**; **junio 2026 falta entero**; **julio falta 01–06** (solo está el 07); el histórico **2021–2025 casi no está** (1 pago ancla). Estos son los rangos que tengo que terminar de bajar de Disapp.

## Reporte de reconciliación (dry-run y commit)

Imprimir y guardar `.json`/`.txt` con: clientes nuevos/actualizados; créditos nuevos/actualizados/stubs; pagos insertados/omitidos-por-duplicado/huérfanos; **suma de `Recaudo` por día y por mes**; conteo de pagos por día y por mes; vendedores sin match.

## Validación (dejámela como comando) — `--validate-sample N`

Toma **N clientes al azar** y muestra, por cada uno: saldo/estado calculado en Presta Ya vs. lo esperado según lo importado, para que yo lo compare a mano contra Disapp. Arrancamos con N=20.

## Requisitos técnicos

- Elegí el lenguaje que ya use el repo para tooling; si no hay preferencia, **Python** (pandas/openpyxl) por el volumen (~107k+ pagos) — o TS con `tsx` + SheetJS si preferís uniformidad con el repo.
- Escritura a Supabase con **service_role** (server-only). Batches (~500 filas por upsert). Logs con progreso. Errores acumulados y reportados al final, sin cortar todo.
- Rutas de Windows: aceptá `C:\Users\Carlos\migracion` como parámetro `--src` (default esa ruta).

## Flujo que voy a seguir (diseñá acorde)

1. `--audit` → confirmo cobertura y qué falta bajar.
2. `--dry-run` contra **PRUEBA** → leo reconciliación.
3. `--commit` contra **PRUEBA** → corro `--validate-sample 20`, comparo contra Disapp.
4. Repito `--commit` en prueba → debe dar **0 nuevos, todo omitido** (idempotencia OK).
5. Recién ahí, `--commit --prod`.

**Primero entregame el mapeo del Paso 0 (incluyendo supervisores y la decisión de huérfanos) y esperá mi OK. NO escribas el importador todavía.**

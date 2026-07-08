# Mapeo del empalme Disapp → Presta Ya (Paso 0)

> Estructura verificada contra los `.xlsx` reales en `C:\Users\Carlos\migracion`.
> Decisiones tomadas por Carlos (2026-07-07). Migración de IDs externos: **0036**.

## Decisiones fijadas

1. **Plata de `recaudos` mal escalada (×1000)** → **reconstruir en el importador**.
   Excel se comió el separador de miles uruguayo: los montos ≥ 1.000 quedaron como
   `float` divididos por 1000 (`1.600` → `1.6`) y los < 1.000 sobrevivieron como
   `int` (`800`, `300`). **Regla:** si la celda es `float` → ×1000; si es `int` →
   tal cual. Los `creditos_*.xlsx` NO tienen el problema (ahí la plata es texto
   `'6.000,00'`). El modo `--validate` reconcilia las sumas.
2. **Documentos repetidos** (~11.490 distintos sobre 13.027) vs `clientes.documento`
   UNIQUE → el **1er** cliente conserva el documento; los repetidos van con
   `documento = NULL`. El documento real siempre queda en `disapp_id` (la llave) y
   en el reporte de revisión. Nunca se descarta un cliente.
3. **Créditos huérfanos** (pagos a ~8.726 créditos, solo 2.748 activos) → **stub de
   crédito histórico**: por cada `Ref. Crédito` sin crédito activo, se crea un
   préstamo `estado='finalizado'` con `total_dias` = `Total Cuotas` del pago (para
   respetar el trigger `dia_credito ≤ total_dias`). Mantiene el enganche y el
   historial. Nunca se descarta un pago.
4. **Vendedores (47)** → los ~44 cobradores se crean como `usuarios` **con login**
   (auth), mapeados por `ID Vendedor` (llave estable). Los 3 `SUPERVISOR ...` se
   crean como `usuarios` rol `supervisor`; sus "créditos" gigantes (relación
   supervisor↔cobrador) **NO** se importan como préstamos de cliente.

## Llaves externas (migración 0036)

| Entidad Presta Ya | Columna nueva | Llave Disapp | Único |
|---|---|---|---|
| `clientes` | `disapp_id` | `ID` (clientes) | sí |
| `usuarios` | `disapp_vendedor_id` | `ID Vendedor` (créditos) | sí |
| `prestamos` | `disapp_credit_id` | `ID Crédito` | sí |
| `prestamos` | `disapp_credit_ref` | `Crédito #` (PRD…) | índice |
| `pagos` | `disapp_pago_id` | `ID Pago` | sí |
| `pagos` | `disapp_credit_ref` | `Ref. Crédito` | — |
| `pagos` | `origen` / `importado_en` | (procedencia) | — |

## CLIENTES  (`clientes_*.xlsx`, 13.027 filas → tabla `clientes`)

| Disapp | Presta Ya | Notas |
|---|---|---|
| `ID` | `disapp_id` | **llave** de idempotencia (UPSERT) |
| `Nombre` | `nombre` | not null |
| `Documento` | `documento` | UNIQUE: 1º conserva, duplicados → NULL (decisión 2) |
| `Teléfono` | `telefono` | |
| `Dirección` | `direccion` | |
| `Latitud`/`Longitud` | (gps del cliente/ruta) | útiles para ruta; ver esquema real de destino |
| `Vendedor` / `Ruta` | → `asignaciones` (cobrador) | match por `Vendedor`→cobrador (por ID vía créditos) |
| `Estado` | `activo` | 'Activo' → true |
| `Observación` | `notas` | |
| `token_acceso` | (auto) | lo genera el default de la tabla |

## CRÉDITOS  (`creditos_*.xlsx`, 2.748 activos → tabla `prestamos`)

| Disapp | Presta Ya | Notas |
|---|---|---|
| `ID Crédito` | `disapp_credit_id` | **llave** (UPSERT) |
| `Crédito #` | `disapp_credit_ref` | respaldo (PRD…) |
| `ID Cliente` | `cliente_id` | vía `clientes.disapp_id` |
| `ID Vendedor` | `cobrador_id` | vía `usuarios.disapp_vendedor_id` |
| `Valor Crédito` | `monto_prestado` | texto `'6.000,00'` → 6000.00 |
| `Valor Cuota` | `cuota_diaria` | texto → número; para no-diario ver `Modalidad` |
| `Cuotas` | `total_dias` | nº de cuotas |
| `Modalidad` | frecuencia (0011) | Diaria/Semanal/Quincenal/Mensual/Personalizado |
| `Fecha Crédito` | `fecha_inicio` | `dd/mm/yyyy` |
| `Estado` | `estado` | 'Activo' → 'activo' |
| `Saldo Pendiente` | (metadato, NO fuente) | Presta Ya calcula el saldo desde pagos |

## PAGOS  (`recaudos_*.xlsx`, histórico → tabla `pagos`)

| Disapp | Presta Ya | Notas |
|---|---|---|
| `ID Pago` | `disapp_pago_id` | **llave** de idempotencia (insert-if-not-exists) |
| `Ref. Crédito` | → `prestamo_id` | vía `disapp_credit_ref`; si no existe → stub histórico (decisión 3) |
| `Recaudo` | `monto` | **reconstruir ×1000 si float** (decisión 1); numeric(12,2), >0 |
| `Cuota #` | `dia_credito` | int ≥ 1; trigger exige ≤ total_dias del préstamo |
| `Fecha Pago` | `registrado_en` | `dd/mm/yyyy` |
| `Vendedor` | `registrado_por` | vía cobrador (nullable si sin match) |
| — | `origen='disapp_import'`, `importado_en=now()` | trazabilidad |

## Alcance elegido: HISTORIAL COMPLETO

Se importa **todo** (decisión Carlos): clientes + créditos activos + los ~8.799
stubs históricos + los 151.572 pagos (129.766 huérfanos incluidos). Enriquece el
scoring desde el día uno. Contracara asumida: los stubs huérfanos se enganchan al
cliente por **documento** (no hay `ID Cliente` en `recaudos`), que tiene duplicados
/vacíos → los que no matcheen quedan en un reporte de revisión, nunca se descartan.

### Frecuencia (Modalidad → `prestamos.frecuencia`)
`Diaria→diario` · `Semanal→semanal` · `Quincenal→quincenal` · `Mensual→mensual` ·
`Personalizado→diario` (solo 8, marcados para revisión). `total_dias` = nº de cuotas.

### Cobradores/supervisores (auth)
Los ~44 cobradores + 3 supervisores se crean como `usuarios` con login de auth
(email sintético estable `cobrador-<idVendedor>@import.prestaya.local` + contraseña
aleatoria → CSV de credenciales para que Mauricio reparta). Mapeo por
`disapp_vendedor_id`. Idempotente vía mapa persistido en `_reportes/`.

## Cobertura real (del `--audit`, 2026-07-07)
151.572 pagos · **50.357 (33%) corregidos ×1000** · $181.513.315 · rango
2021-03 → 2026-07. **2026 (ene–jul) está denso y completo**; 2021–2025 casi no está
(los "días faltantes" son esos años viejos, no huecos del período operativo).

## Orden de importación

1. **Cobradores/supervisores** (`usuarios`, UPSERT por `disapp_vendedor_id`).
2. **Clientes** (UPSERT por `disapp_id`; documento dup → NULL).
3. **Créditos activos** (UPSERT por `disapp_credit_id`; enganchan cliente+cobrador).
4. **Stubs de créditos históricos** (desde `Ref. Crédito` de pagos sin crédito activo).
5. **Pagos** (insert idempotente por `disapp_pago_id`; monto reconstruido).

## Flujo de ejecución (Carlos)

1. `--audit` → cobertura de fechas, días faltantes, vendedores, huérfanos (sin DB).
2. `--dry-run` contra **PRUEBA** → reconciliación (no escribe).
3. `--commit` contra **PRUEBA** → `--validate-sample 20`, comparar contra Disapp.
4. `--commit` de nuevo en prueba → debe dar **0 nuevos** (idempotencia OK).
5. Recién ahí `--commit --prod`.

# Reconstrucción de pagos NO diarios (empalme Disapp) — IMPLEMENTADO

> Estado: **implementado y aplicado a PRUEBA** (`scripts/empalme_disapp.py`, paso [6]).
> Fuente del diseño: `fix-empalme-pagos-nodiarios-prestaya.md`.

## El problema (verificado, no deducido)

La exportación de recaudos de Disapp es la vista **"Recaudos Diario"** → solo trae
pagos de créditos de modalidad **DIARIA**, y encima **solo dentro de la ventana de
fechas exportada** (el grueso es mar–jul 2026). Faltan:
1. Los pagos de créditos **semanales / quincenales / mensuales / VIP de supervisor**
   (Disapp no ofrece vista para exportarlos).
2. Los pagos **DIARIOS viejos** anteriores a la ventana del export (créditos de 2025
   y antes).

**Impacto:** esos créditos llegan a la DB con menos pagado del real → inflan mora y
cartera. La única fuente del total pagado para ellos es la columna **`Pagos`** del
`creditos_*.xlsx`.

## La verdad es el DINERO, no las cuotas (verificado sobre 2.749 activos)

- **`Pagos` + `Saldo Pendiente` == `Total c/ Intereses`** en el **100%** de los
  créditos activos → las columnas de dinero son perfectamente autoconsistentes.
- **`cuota × cuotas` == `Total c/ Intereses`** salvo ~$1.900 en total (redondeo).
- **`Cuotas Pend.` solo concuerda con el dinero en el 25,6%** → **NO es fiable**;
  se usa solo como dato **informativo** (nunca bloquea la reconciliación).

Ejemplo real que rompió el supuesto del MD: `PRD0002535750` (diario, 31/03/2025) que
"debía estar completo" tenía solo **$137.000** en recaudos vs **$625.950** en `Pagos`
→ SÍ se reconstruye (+$488.950) y su saldo cae **exacto** en $484.050 = Disapp. Los
diarios viejos también estaban incompletos.

## Cómo encaja con el cartón (el "acople")

`lib/cartones.ts` es **FIFO ACUMULADO**: el estado de cada cuota sale del **total
pagado** (`min(cuota, totalPagado − i·cuota)`), NO del `dia_credito` de cada pago
(el `Cuota #` de Disapp es un snapshot inútil). ⇒ para que mora y saldo salgan
exactos basta **una identidad**: `suma(pagos del crédito) == Pagos`.

Por eso un solo lump daría el mismo resultado en dinero. Igual **se distribuye
cuota-por-cuota** (llenando las cuotas más tempranas aún no cubiertas, con cobertura
FIFO-consistente) para: comprobante natural del cliente + respetar el trigger
`dia_credito ≤ total_dias`. El resultado en dinero es idéntico.

## Implementación (`scripts/empalme_disapp.py`)

- `load_creditos` ahora parsea `Pagos`, `Saldo Pendiente`, `Total c/ Intereses`,
  `Cuotas Pend.`, `Estado`.
- `reconstruir_creditos(d, only_refs=None)` — **pura**, calcula los ajustes por
  crédito activo. Cap para no exceder el cartón; residuo de centavos al último
  sembrado; nunca `dia_credito > total_dias` ni `monto ≤ 0`.
- Paso **[6]** en `commit_import` (corre en dry-run y commit): siembra pagos
  `origen='ajuste_migracion'`, `registrado_en = fecha_inicio` (no contamina
  "recaudado hoy/mes"), `registrado_por = NULL`, `disapp_pago_id =
  'ajuste-<credit_id>-<dia>'` (idempotente vía índice único de 0036).
- **`--probe REFS`** cuadre dirigido; **`--audit`** reporta el gap global;
  `reconstruccion_revision.csv` con los créditos a revisar.

## Resultado (dry-run/commit sobre PRUEBA, 2026-07-08)

| Métrica | Valor |
|---|---|
| Créditos activos reconstruidos | **251** (145 diario, 93 sem, 9 quinc, 4 mens) |
| Pagos de ajuste sembrados | **3.582** |
| Monto reconstruido | **$13.885.082** |
| 🔴 Sub-cobrados (falta plata real) | **0** |
| Recaudos más nuevos que el snapshot `Pagos` (benigno) | 288 (+$288.606) |
| Redondeo `cuota×cuotas ≠ Total` (benigno) | 71 |
| **Cartera pendiente global** | **$93,88M** (≈ Σ Saldo Disapp $94,17M; el −$0,29M son los pagos más nuevos) |

**Efecto en el dashboard:** Capital en calle **$107,7M → $93,9M** (el libro completo
y real; NO el tile "$68,5M" de Disapp, que esconde parte de su propia cartera —
verificado en sesiones previas). La mora baja al dejar de figurar como impagos los
créditos no-diarios y los diarios viejos.

## Idempotencia / inmutabilidad

- Ajustes con `disapp_pago_id` determinista → re-correr `--commit` = **0 nuevos**.
- Cero UPDATE/DELETE sobre `pagos`. El "arreglo" es re-import aditivo a base de PRUEBA.
- Respeta `monto > 0`, `dia_credito >= 1` y el trigger `dia_credito ≤ total_dias`.

## Entorno
- Base de PRUEBA: **`prestaya-pruebas`** (ref `kvmqlkqfgjimfpzlwsdt`).
- `.env.prueba` / `.env.local` apuntan ahí. Dev server en `localhost:3000`.

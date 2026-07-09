# Prompt Claude Code — Fix empalme: reconstrucción DISTRIBUIDA de pagos no-diarios

> Pegar en Claude Code, dentro del repo de Presta Ya, en el importador
> `scripts/empalme_disapp.py`. Objetivo único: que los créditos **no-diarios**
> (semanal / quincenal / mensual / VIP de supervisor) dejen de llegar con $0
> pagado y **la mora del dashboard quede exacta**, sin tocar la inmutabilidad
> de pagos. Corregir el importador y re-importar a base LIMPIA de PRUEBA.
> Urgente: esto va a producción con Mauricio.

---

## 1. PROBLEMA (verificado, no deducido)

El export de recaudos de Disapp es la vista **"Recaudos Diario"**: solo trae los
pagos de créditos de **modalidad diaria**. Disapp NO ofrece vista/filtro para
exportar los pagos de créditos **semanales, quincenales, mensuales** ni de la
**cartera VIP de supervisores**. Resultado actual del import:

- ~40% de los créditos semanales (~$33,4M de capital) entran con **$0 pagado**,
  aunque el propio `creditos_*.xlsx` de Disapp, en su columna **`Pagos`** (total
  ya pagado), confirma que SÍ pagaron. Eso **infla la mora** artificialmente.
- Evidencia: `PRD0003208827` (semanal) → Disapp `Pagos`=$305.000,
  `Saldo Pendiente`=$640.000, pero **0 pagos** en todos los `recaudos_*.xlsx`.
  Control diario que SÍ está bien: `PRD0002535750` (diario) tiene sus 28 pagos.

Única fuente disponible para esos pagos = la columna `Pagos` del Excel de créditos.

## 2. RESTRICCIÓN CLAVE (verificada en `lib/cartones.ts`) — POR QUÉ NO SIRVE UN LUMP

El cartón de Presta Ya evalúa cada cuota **estrictamente por su propio
`dia_credito`**, SIN cascada: para la cuota `i` solo mira los pagos imputados a
esa cuota (`pagosPorDia[i]`). Pagar de más en la cuota 1 **NO** derrama a las
cuotas 2, 3, 4… El estado por cuota es:

```
pagado >= cuota      → pagado
0 < pagado < cuota   → pendiente
día pasado, pagado=0 → atrasado   (mora)
```

**Implicancia:** si se siembra **un solo pago de ajuste por toda la diferencia
en el día 1**, el saldo total queda bien (`falta = totalAPagar − totalPagado`),
pero **las cuotas 2..N vencidas siguen en `atrasado`** → la mora NO baja, incluso
empeora. Un lump en el día 1 es un bug, no un fix.

**Solución correcta = distribuir el monto reconstruido cuota por cuota**, para que
las cuotas realmente cubiertas queden `pagado` y solo las no alcanzadas (y ya
vencidas) queden `atrasado`. Así mora y saldo quedan ambos exactos vs Disapp.

## 3. ALGORITMO DE RECONSTRUCCIÓN (implementar así, exacto)

Se ejecuta **por cada crédito activo**, DESPUÉS de importar los recaudos reales
(así sabemos qué cuotas ya están cubiertas por pagos verdaderos). Del
`creditos_*.xlsx` se leen (texto uruguayo `'6.000,00'` → float): `Valor Cuota`
(= `cuota`), `Cuotas` (= `total_dias`), `Cuotas Pend.`, `Pagos` (total pagado
según Disapp), `Total c/ Intereses`, `Saldo Pendiente`, `Fecha Crédito`.

```
cuota        = Valor Cuota
total_dias   = Cuotas
pagos_disapp = Pagos                      # total pagado según Disapp
ya_importado = sum(recaudos reales de ese crédito ya insertados)

# --- Precheck de consistencia (rigor: verificar contra data real) ---
# El cartón calcula totalAPagar = cuota * total_dias. Si eso NO coincide con
# Total c/ Intereses (por redondeo de la cuota), el saldo reconstruido no va a
# igualar Saldo Pendiente aunque los pagos estén perfectos.
if abs(cuota * total_dias - total_c_intereses) > TOL_MONTO:   # TOL_MONTO ≈ 1.0
    marcar_revision(credito, "cuota*cuotas != Total c/Intereses")   # no frenar, seguir

# --- ¿Hace falta reconstruir? Solo si Disapp dice que pagó más de lo importado ---
reconstruir = round(pagos_disapp - ya_importado, 2)
if reconstruir <= 0:
    continue     # diario completo, o nada que reconstruir

# --- Cuántas cuotas debería cubrir (DOS fuentes independientes, se cruzan) ---
k_por_monto  = pagos_disapp / cuota                 # floor = completas
k_por_cuotas = total_dias - cuotas_pend             # Disapp lo da directo
if abs(round(k_por_monto) - k_por_cuotas) > 1:      # difieren más de 1 cuota
    marcar_revision(credito, f"k_monto={k_por_monto:.2f} vs k_cuotas={k_por_cuotas}")

# --- Estado ya cubierto por recaudos reales (por dia_credito) ---
pagado_por_dia = {}                     # dia -> monto real ya imputado
for pago_real in recaudos_del_credito:
    pagado_por_dia[pago_real.dia_credito] += pago_real.monto

# --- Sembrar la diferencia llenando las cuotas MÁS TEMPRANAS aún no cubiertas ---
restante = reconstruir
sembrados = []
for dia in range(1, total_dias + 1):
    if restante <= 0: break
    falta_dia = round(cuota - pagado_por_dia.get(dia, 0), 2)   # lo que falta en esa cuota
    if falta_dia <= 0: continue                                # cuota ya completa (real)
    monto = round(min(falta_dia, restante), 2)
    if monto <= 0: continue
    sembrados.append({
        "prestamo_id":     prestamo_id,
        "dia_credito":     dia,                        # 1..total_dias  → respeta trigger
        "monto":           monto,                      # numeric(12,2), > 0
        "disapp_pago_id":  f"ajuste-{disapp_credit_id}-{dia}",   # determinista → idempotente
        "disapp_credit_ref": credit_ref,
        "origen":          "ajuste_migracion",
        "registrado_en":   fecha_inicio,               # NO contamina "recaudado hoy/mes"
        "importado_en":    now(),
        "registrado_por":  None,                       # sin cobrador (ajuste de sistema)
    })
    restante = round(restante - monto, 2)

# Residuo de redondeo (centavos): sumarlo al último sembrado, nunca crear día > total_dias
if restante > 0 and sembrados:
    sembrados[-1]["monto"] = round(sembrados[-1]["monto"] + restante, 2)
elif restante > 0.5:      # no cupo en el cartón → dato inconsistente
    marcar_revision(credito, f"sobró {restante} sin cuota donde ubicarlo")
```

### Casos borde a manejar explícitamente
- **Crédito 0% VIP de supervisor** (`es_float_supervisor=true`, `Total = Valor`):
  misma lógica; `cuota = Valor/Cuotas`. No "corregir" el 0%.
- **Crédito totalmente pagado** (`Cuotas Pend.=0`, `Saldo=0`): se llenan todas las
  cuotas → cartón todo `pagado`. Queda activo (Disapp lo lista activo → replicar).
- **`Pagos > Total c/ Intereses`** (sobrepago / error de dato): cap `reconstruir`
  para no exceder el total del cartón; marcar a revisión.
- **`ya_importado > pagos_disapp`** (recaudos traen más que el Excel): NO sembrar
  (reconstruir sale negativo); marcar a revisión.
- **Modalidad `Personalizado`**: quedan en `frecuencia='diario'` (ya decidido);
  aplican igual, marcados para revisión.

## 4. IDEMPOTENCIA E INMUTABILIDAD (no negociable)
- Cada pago sembrado lleva `disapp_pago_id` sintético determinista
  (`ajuste-<credit_id>-<dia>`). Insert con `on conflict (disapp_pago_id) do nothing`
  (índice único de 0036). Re-correr el importador ⇒ **0 nuevos**.
- Los pagos NUNCA se borran ni editan. El "arreglo de las tablas" se hace
  **re-importando a base LIMPIA de PRUEBA** (truncar el alcance del import y
  re-correr), no con UPDATE/DELETE sobre `pagos`.
- Respetar el trigger `dia_credito ≤ total_dias` (el algoritmo ya lo garantiza).

## 5. VALIDACIÓN / RECONCILIACIÓN (modo `--validate`)
Después de sembrar, por cada crédito reconstruido, correr el **mismo cálculo del
cartón** y verificar las **tres** identidades contra el Excel de créditos:

1. `sum(pagos del crédito)  == Pagos`            (columna) ± TOL_MONTO
2. `cartón.falta            == Saldo Pendiente`  (columna) ± TOL_MONTO
3. `count(cuotas con pagado ≥ cuota) == Cuotas − Cuotas Pend.`  (± 1)

Todo crédito que falle cualquiera de las tres → fila en
`_reportes/reconstruccion_revision.csv` (credit_ref, motivo, esperado, obtenido).
Al final imprimir: nº créditos reconstruidos, nº pagos sembrados, monto total
sembrado, nº a revisión, y **suma de cartera pendiente global** (debe acercarse
a **$68,3M**, el capital en calle real — NO al $88,8M bruto).

## 6. PRUEBA DIRIGIDA ANTES DEL MASIVO (obligatoria)
Antes de sembrar los ~miles, correr un modo `--probe PRD0003208827,PRD0002535750`
que reconstruya SOLO esos y muestre lado a lado: `Saldo Pendiente` y `Cuotas Pend.`
de Disapp vs los que da el cartón de Presta Ya tras la reconstrucción.
- `PRD0003208827` (semanal, hoy $0) debe pasar a `Saldo=$640.000`, cuotas pagadas
  cuadrando con Disapp.
- `PRD0002535750` (diario, control) NO debe tocarse (ya está completo → `reconstruir<=0`).
Si esos dos cuadran, recién ahí el masivo.

## 7. INTEGRACIÓN CON EL PIPELINE EXISTENTE
Encajar en el orden de import ya definido (cobradores → clientes → créditos
activos → stubs históricos → pagos reales). Agregar la reconstrucción como
**paso final, después de los pagos reales**, para conocer lo ya cubierto.
Reusar flags existentes: `--audit` (reporta cuántos créditos quedarían con
`recaudos < Pagos`, sin escribir), `--dry-run` (reconstruye en memoria y valida,
no inserta), `--commit`, `--validate`, `--prod`. `--probe` es nuevo.

Ejecución de Carlos:
1. `--audit` → cuántos no-diarios llegan con gap.
2. `--probe PRD0003208827,PRD0002535750` → cuadre puntual.
3. `--dry-run` contra PRUEBA → reconciliación global (no escribe).
4. Base LIMPIA + `--commit` contra PRUEBA → `--validate`.
5. `--commit` de nuevo → **0 nuevos** (idempotencia).
6. Recién ahí `--prod`.

## 8. CHECKLIST DE ACEPTACIÓN
- [ ] `PRD0003208827` reproduce `Saldo Pendiente` y `Cuotas Pend.` de Disapp.
- [ ] Ningún crédito diario ya completo se toca (`reconstruir<=0`).
- [ ] Las 3 identidades de reconciliación pasan para >X% de créditos; el resto,
      en `reconstruccion_revision.csv` con motivo.
- [ ] Re-correr `--commit` da 0 pagos nuevos (idempotente).
- [ ] La **mora global del dashboard baja** al nivel real (los ~$33,4M semanales
      dejan de figurar como impago); cartera pendiente global ≈ $68,3M.
- [ ] Cero UPDATE/DELETE sobre `pagos`; todo vía inserts idempotentes en base limpia.
- [ ] Ningún `dia_credito > total_dias`; ningún pago sembrado con `monto <= 0`.

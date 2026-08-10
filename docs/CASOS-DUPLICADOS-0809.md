# Créditos duplicados — qué se hizo y qué queda (09-08-2026)

Trazabilidad de los tres casos que aparecieron al comparar contra el export fresco
de Disapp. **Nada se borró**: la base prohíbe borrar créditos
(`prestamos_no_borrar`, P0403) y tiene razón — se pasaron a `cancelado`, que deja
la fila y su historia. Reversa en `scripts/_revert_duplicados_0809.json`, y cada
cancelación quedó registrada en la tabla `auditoria`.

---

## ✅ RESUELTO · JORGE ANDRÉS RODRÍGUEZ TARAMASCO — $16.000

| | crédito | creado | pagos | qué se hizo |
|---|---|---|---|---|
| queda | `ef9ac291` | 08-08 19:30 · Edward Muñoz · **renovación** | $1.600 | activo |
| se cancela | `6c8c08c1` | 08-09 19:04 · Edward Muñoz | ninguno | **cancelado** |

**Qué pasó.** Edward pidió la renovación a la oficina el 06-08. Mauricio la aprobó
el 08-08 a las 19:30 y el crédito nació — pero **Edward nunca se enteró**: la tabla
de solicitudes tiene RLS solo-gestor, no había aviso ni pantalla de "mis pedidos".
Al día siguiente lo volvió a colocar. Un minuto después registró el pago… sobre el
primero, que es el bueno.

**Ya no puede volver a pasar**: el home del cobrador ahora muestra *"La oficina
aprobó — entregale $16.000 a JORGE"*, y al colocar hay un candado de 15 minutos
para el mismo monto al mismo cliente.

## ✅ RESUELTO · ROSMARIE BELDRAMINA VELAZQUIEZ — $40.000

| | crédito | creado | pagos | qué se hizo |
|---|---|---|---|---|
| queda | `b7010de5` | 08-06 04:13 · importado · ref `PRD0003609741` | $1.200 + $1.200 | activo |
| se cancela | `5c7c466c` | 08-05 20:22 · Karent Londoño | ninguno | **cancelado** |

**Qué pasó.** Karent lo cargó en la app el 08-05 y el empalme importó el MISMO
préstamo el 08-06. Queda el importado porque trae la referencia de Disapp y los dos
pagos. Es el caso que dio origen al empalme de los 80 nativos.

**Ya no puede volver a pasar**: el empalme ahora ADOPTA el crédito que ya nació en
la app en vez de crear uno al lado (`scripts/empalme-0804.py`).

---

## ⚠️ SIN RESOLVER — necesita a Leonel Maciel

### MAICOL RIVERO — dos créditos de $7.000, **los dos con pagos**

| crédito | creado | cuota | pago |
|---|---|---|---|
| `9c213324` | importado · $20.000, ref `PRD0003315435` | $1.500 × 16 | **$24.000** el 08-08 17:51 |
| `f494ff13` | 08-08 **17:53** · Leonel · **renovación** | $494 × 17 | **$8.398** el 08-08 17:54 |
| `424f9f54` | 08-08 **17:55** · Leonel | $494 × 17 | **$1.500** el 08-08 18:05 |

**Lo que se puede reconstruir.** Maicol terminó de pagar el crédito viejo de
$20.000 (el pago de $24.000 = 16 × $1.500). Leonel le renovó por $7.000 a las
17:53. Un minuto después registró **$8.398**, que es *exactamente* 17 × $494 — o
sea, el crédito nuevo entero de una sola vez. Dos minutos más tarde creó **otro**
crédito de $7.000 y le cargó $1.500.

**Por qué no lo toqué.** Hay plata registrada en los dos y la historia no cierra
sola: el pago de $8.398 no parece un cobro real (salda el crédito completo al
minuto de crearlo), y el de $1.500 tiene el importe de la cuota del crédito VIEJO,
no del nuevo. Adivinar acá cuesta plata de verdad.

**Qué hay que preguntarle a Leonel**, textual:
1. ¿A Maicol le entregaste **$7.000 una vez o dos**?
2. El registro de **$8.398** de las 17:54, ¿qué era? (parece un "cobrar todo"
   apretado sin querer)
3. El de **$1.500** de las 18:05, ¿era la cuota del crédito viejo?

Con esas tres respuestas se anulan los pagos que no correspondan (nunca se borran:
`anulado = true` con quién y por qué) y se cancela el crédito que sobre.

---

## Lo que quedó midiendo bien

- **0** referencias de Disapp repetidas entre créditos activos.
- **2872** créditos activos · $129.717.158 de capital.
- **80** créditos nativos empalmados con su gemelo: el próximo empalme no los duplica.
- **16** créditos que solo viven en la app (no tienen gemelo en Disapp) — correcto,
  son colocaciones que la oficina todavía no registró.

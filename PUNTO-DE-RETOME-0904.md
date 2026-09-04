# Punto de retome — unificación del alta de créditos (04-09)

Estado: **repo limpio, todo verde, nada deployado**. El módulo nuevo está escrito
y probado pero **todavía no está conectado**: la conducta en producción es
exactamente la de antes. Ese fue el corte deliberado — se puede retomar sin
prisa y sin riesgo.

---

## 1. Lo que se descubrió al mapear (antes de tocar nada)

La tarea hablaba de "4 puertas". **Son seis caminos de servidor**, no cuatro:

| # | Dónde | Persiste con |
|---|---|---|
| 1 | `lib/acciones/cobradorCredito.ts:502` — renovar desde la calle | `crearRenovacion` |
| 2 | `lib/acciones/cobradorCredito.ts:816` — nueva venta desde la calle | `crearCreditoNuevoDb` |
| 3 | `lib/acciones/creditoNuevo.ts:161` — alta desde el panel | `crearCreditoNuevoDb` |
| 4 | `app/admin/(panel)/renovaciones/actions.ts:168` — renovar desde el panel | `crearRenovacion` |
| 5 | `…/actions.ts:311` — **el supervisor aprueba un pedido de VENTA** | `crearCreditoNuevoDb` |
| 6 | `…/actions.ts:398` — **el supervisor aprueba un pedido de RENOVACIÓN** | `crearRenovacion` |
| + | `lib/data/tienda.ts:853` — convertir un lead de tienda en venta | RPC `crear_credito_venta_seguro` |

Las dos que faltaban en la lista (5 y 6) son las de **aprobar un pedido**: crean
créditos por los dos caminos y no tienen pantalla propia, así que no se veían.
Cualquier regla que se arregle solo en "las 4 puertas" las deja afuera.

La tienda es un séptimo camino por RPC. **Queda fuera de alcance por ahora** —
toma el formato del producto vivo, que es un problema distinto (ya anotado en
`AUDITORIA-04-09.md`).

## 2. Lo que ya está hecho

### `lib/domain/credito.ts` (nuevo, puro, sin IO)

El único lugar donde se deciden los términos de un crédito. Recibe lo que la
pantalla pidió + el crédito de referencia ya leído, y devuelve una de tres
cosas: **crear** (con los términos sellados), **solicitud** (va a aprobación) o
**rechazo** (con el motivo ya redactado).

Lo que unifica, que hoy está copiado en seis lados:

- normalización de monto y cuotas;
- **formato obligatorio** — sin default silencioso a "diario";
- el tope de 366 cuotas rige lo tecleado, **nunca lo heredado** (los Disapp de
  555 cuotas se repiten tal cual);
- el techo, en **una tabla** (`techosDe`) en vez de cuatro combinaciones sueltas
  de `techoVentaNueva` / `techoVentaGestor` / `montoRenovacionAutoAprobable` /
  `techoRenovacion`;
- la cuota, **una sola fórmula** para las dos vías;
- fecha de inicio = próximo día de cobro;
- la clave de idempotencia.

Las diferencias entre puertas quedaron como **dos parámetros**: `via`
(`renovacion` | `venta`) y `autoridad` (`cobrador` | `gestor`). No hay ramas
paralelas.

**Hallazgo del camino**: `calcularCuotaRenovacion` y `calcularCuotaCreditoNuevo`
dan **el mismo peso siempre** — incluso con la tasa rota del import (0%), donde
una cae al piso de 1,2 y la otra al interés del negocio, que es 20%. Por eso se
pudo unificar el cálculo sin mover ni un peso de la cartera. Hay un test que lo
fija (`las 4 puertas coinciden TAMBIÉN con la tasa rota`).

### `lib/domain/credito.test.ts` — 30 pruebas, la de aceptación incluida

La que pediste: *el mismo pedido por las cuatro puertas produce términos
idénticos* (monto, cuota, cuotas, formato, interés, fecha, sobre-CAP). Más:
ninguna puerta puede crear sin formato explícito; la tabla de techos puerta por
puerta; el heredado de $120.000 que se renueva tal cual; el de 555 cuotas.

## 3. Calibración del aviso de coherencia (medida contra la cartera viva)

3.133 créditos activos: **2.350 diarios · 709 semanales · 56 quincenales · 18 mensuales**.

La señal correcta no es la cuota sobre el capital sino **la duración del plan en
días de cobro** (`cuotas × días_por_formato`, con el paso Lun–Sáb). Ya incorpora
el formato, así que sirve para los cuatro por igual.

| Regla | Dispara sobre | De los cuales importados |
|---|---|---|
| La de hoy (`diario` & ≤8 cuotas & cuota ≥20%) | 18 ($475.500) | 15 |
| **`≥2 cuotas` & duración ≤8 días & cuota ≥20%** | **11 ($380.500)** | **9** |

La generalizada es **más precisa** (11 contra 18) y además cubre los cuatro
formatos. **Sobre los 709 semanales no dispara ninguna vez** — los semanales
largos de capital grande (los 126 legítimos, $67,5M) quedan intactos, que era la
condición que pusiste. De los 11, solo **2 son de la app**: MARIA PICA y ANDREA
JHOANA GONZALEZ. Los otros 9 son heredados de Disapp.

## 4. Lo que falta (en orden)

1. **Conectar las 6 puertas** al módulo. El módulo ya replica su conducta exacta
   (los 30 tests lo fijan), así que es reemplazar el bloque duplicado por una
   llamada — sin cambio de conducta salvo donde hoy hay un bug.
2. **Aviso de coherencia por duración** (la fila en negrita de arriba), viniendo
   del módulo único → aparece en las cuatro pantallas por construcción.
3. **Rótulos de unidades.** Ya confirmado uno: la ficha del cobrador dice
   **"Cuota diaria"** y **"Días cubiertos"** en los cuatro formatos
   (`app/cobrador/(app)/cliente/[id]/page.tsx:355-357`) — a un semanal le dice
   "cuota diaria". El módulo ya trae `ROTULO_CUOTA` para eso. Falta el barrido
   completo (`scoring.ts` cuenta cuotas y las rotula "días"; `alerta.ts`;
   `metricas.ts` con tramos "1–7 días").
4. **Caja/cierre** y **ficha sin scroll** (puntos 4 y 5 del encargo).
5. **Baselines** calibrados sobre los datos sucios del empalme del 17-08.

Había un mapeo de cuatro lentes corriendo (puertas · rótulos · baselines ·
ficha) que quedó sin recoger: **conviene relanzarlo al retomar**, porque los
puntos 3, 4 y 5 salen de ahí.

## 5. Sigue esperando tu decisión (de auditorías anteriores)

- **Los 222 pares de pagos duplicados del empalme ($997.474)** — el agujero ya
  está cerrado, falta decidir si se anulan. Es plata real: esos clientes tienen
  el saldo más bajo de lo que corresponde.
- Push no se puede activar desde la app del cobrador (0 suscripciones).
- La tienda toma el formato del producto vivo.
- El float de supervisor ($69,9M, 52% del capital activo) sin marcar.

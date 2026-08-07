# Estado al cierre del 07-08-2026 — para retomar

Todo lo de abajo está **commiteado, desplegado en producción y con smoke verde**
(`959 tests`, build limpio). Último commit: `e6ae477`.

---

## 1. Lo que hay corriendo AHORA y hay que recuperar

**Auditoría fuerte de renovaciones** (workflow `wnbjs7nt1`, run `wf_873e67c6-110`).
Seis lentes: la plata · modos de falla · interfaz en la calle · la oficina · los
datos contra la base viva · **lo que falta** (qué necesita una renovación en la
vida real más allá de las cuotas). Cada hallazgo pasa por 3 escépticos.

- Resultados por agente: `C:\Users\Carlos\.claude\projects\c--Users-Carlos-Desktop-prestaya\b87513d3-f36d-42c1-9265-d00b6a29c46c\subagents\workflows\wf_873e67c6-110\journal.jsonl`
  (una línea `{"type":"result",...}` por agente terminado).
- Script: `...\workflows\scripts\auditoria-renovaciones-wf_873e67c6-110.js`

⚠️ **Al leerlo, filtrar primero:** el flujo de renovación/venta cambió MUCHO
mientras el workflow corría (commits `d0349ff` → `e6ae477`). Varios hallazgos ya
están arreglados. Contrastar contra el código actual antes de tocar nada.

La otra verificación (candado anti doble-cobro, `wf_91a5ece2-f25`) **ya se
procesó**: encontró 2 errores míos, los dos corregidos en `74726bf`.

---

## 2. Reglas de negocio que se fijaron hoy (son ley)

1. **Renovar = repetir TAL CUAL.** Mismo monto, misma cuota, mismas cuotas. Sin
   campos, sin decisiones, un toque. El +20% NUNCA fue un aumento automático: es
   solo el techo hasta donde el cobrador aprueba solo.
2. **Nueva venta = el mismo momento, eligiendo monto y cuotas.** Si el cliente
   viene de terminar un crédito, va por el camino de renovación (cierra el
   anterior en la misma operación atómica); si no, es un alta común.
3. **Un cliente PUEDE tener DOS créditos a la vez, sin estar al día.** Medido:
   471 clientes ya los tenían; el sistema lo prohibía y dejaba fuera al 86% de la
   ruta (1.127 de 1.314 clientes de Zona Centro).
4. **La META del día es solo la cuota que VENCE hoy.** La mora arrastrada se
   cobra y se muestra, pero no infla la meta: a un semanal le vence UNA cuota por
   semana, no seis.
5. **El capital COLOCADO se descuenta de la caja del cobrador** (sale de su
   bolsillo) y también del arrastre del día siguiente.
6. Las dos puertas se entran **desde la ficha del cliente**, que es donde el
   cobrador está parado.

---

## 3. Los 10 commits de hoy

| commit | qué |
|---|---|
| `d25529a` | El capital colocado se descuenta de la caja |
| `b52be8e` | Ruta: fuera el cliente de otro cobrador · créditos nuevos empiezan mañana |
| `4b93fd5` | Cuota del semanal ≠ 6 veces por semana · colocado completo · **0136** |
| `d8792d0` | Candado anti doble-cobro en el servidor · meta del panel = la del teléfono |
| `d0349ff` | Renovar por otro monto se entiende sin explicación |
| `23c3b6e` | Cuotas editables al renovar |
| `1b5151e` | Las dos puertas desde la ficha del cliente |
| `74726bf` | El candado frenaba la 2ª vuelta · la bandera nunca llegaba |
| `e6ae477` | Dos créditos a la vez |

**Migración `0136_rendicion_capital_colocado.sql` ya corrida por Carlos.**

---

## 4. Datos medidos hoy (no re-medir sin necesidad)

- **Meta del día**: la app pedía $3.177.260 cuando vencían $1.223.686 (2,6×). El
  domingo pedía $3.164.099 con $0 venciendo. *(Ojo: mi primer número, 5,4×, era
  incorrecto — incluía cartera vencida que la ruta ya excluía.)*
- **Semanales**: 544 créditos / $3.960.742 viendo cuota entera los 6 días.
- **Duplicados de cobro**: 21 pares en 4 días → 2 a 40 y 50 **segundos** (reales)
  y 16 a **2,3–4,9 horas** (segunda vuelta, legítima). 163× de margen entre los
  dos grupos → la ventana de 10 min es holgada.
- **Adopción**: el 06-08 solo 6 de 18 cobradores cargaron en la app ($219.890 vs
  $702.788 en Disapp). Es el piloto en paralelo, no una falla.
- **Cartera vs Disapp**: 0,036% de delta sobre los 2.284 créditos comunes.
- **Integridad interna**: 0 en siete de ocho chequeos clásicos.

---

## 5. PENDIENTE — decisiones de Carlos / Mauricio

1. 🔴 **ROSMARIE BELDRAMINA** figura **dos veces con el mismo préstamo de $40.000**
   (uno cargado en la app el 05, otro que entró por el empalme con
   `PRD0003609741`). Hay que anular uno.
2. 🔴 **Los 15 créditos nacidos en la app tienen los 15 su gemelo en Disapp.** La
   próxima corrida del empalme crea 14 duplicados más ($209.000). Decidir antes:
   parar el empalme para Zona Centro, que dejen de cargar en Disapp, o enseñarle
   al empalme a detectar el gemelo.
3. **111 créditos que Disapp dio de alta y no tenemos** ($1.806.631; 64 de Zona
   Centro por $1.147.100). ¿Se importan?
4. **59 clientes asignados a 2 rutas a la vez** (152 créditos, $7.221.915). La app
   ya muestra a cada uno solo su crédito, pero la asignación duplicada sigue.
5. **$533.923 de bases entregadas el 06-08 sin una sola rendición.** ¿Volvió ese
   efectivo?
6. **43 créditos activos ya saldados**, 10 con sobre-cobro ($10.930 · Gabriela
   Otonelli $6.000).
7. **Cuentas SUPERVISOR** (`Cartera Zona Centro, Boso` y `Zona Sur, Cesar`) inflan
   la meta del panel en $951.714 sin que les venza un peso. Existe la columna
   `es_float_supervisor` — no hace falta DDL.
8. **1 doble cobro confirmado + 2 a preguntar**: Carlos Santiago Da Silva $600 dos
   veces en 40 s (María Artunduaga) · Víctor Pereira, 2 créditos recobrados a las
   15:48. Total $2.920, de los cuales $600 claramente mal.
9. **¿Tope de créditos por cliente?** Hoy no hay: solo el CAP por crédito y el
   techo del tramo. Si el negocio quiere un máximo (por cantidad o por exposición
   total), hay que fijar el número.

---

## 6. PENDIENTE — técnico, señalado y NO hecho

- **El recibo sale antes de que el cobro llegue al servidor** (la app encola y
  sincroniza 9 s después). Es deliberado para trabajar sin señal, pero si el
  servidor rechaza, el cliente ya tiene el papel. Con la regla estrecha del
  candado casi no se dispara.
- **El botón de adelantar cobra siempre una cuota entera.** Si el cliente paga la
  cuota y a la tarde entrega $500 de mora, el único camino confirmable ofrece la
  cuota completa. Dejó de ser urgente al angostar el candado.
- **`colocado` es el único término de la caja sin invariante del cron**
  (`recaudado` lo cruza INV8, `gastos` INV9, `base` INV6). Vale una INV13.
- **RPC `returns table` que pueden truncar**: `app_vigilancia_pagos` (52×30 =
  1.560 filas garantizadas cuando todos cobren en la app) y
  `app_reconciliacion_violaciones` (hoy 292). Devolver `jsonb`.
- **`.limit(N)` sobre `pagos` de hoy** en `lib/data/equipo.ts:107`,
  `lib/data/uso.ts:156`, `lib/data/actividad.ts:343`. Hoy ~150 cobros/día; revientan
  pasando 1.000.
- **Textos que enseñan la fórmula vieja** del esperado (sin `colocado`):
  `app/admin/(panel)/caja/page.tsx:142,227` · `.../cierre/page.tsx:167` ·
  cabeceras de `lib/cierreZona.ts` y `lib/rendicion.ts`.
- **El semanal cambia de día de la semana al renovar** (venía los jueves, el nuevo
  vence los sábados). Si al negocio le importa, hay que correr al próximo día de
  cobro que coincida con el weekday del anterior.
- **`getSolicitudesPendientes`** no usa `traerTodo` (hoy 2 filas, sin riesgo).

---

## 7. Cómo verificar que algo salió de verdad

`prod 200` NO prueba nada. Marcador funcional con sesión real:

```
node scripts/_smoke-piloto.mjs      # 13 checks, requiere CHROME_PATH
npx vercel ls --prod                # que diga ● Ready
```

Canal SQL de solo lectura: python + pg8000, `SUPABASE_DB_URL` de `.env.local`,
ssl con `check_hostname=False, verify_mode=CERT_NONE`, `PYTHONIOENCODING=utf-8`
en heredocs. Tests: `npx vitest run --no-file-parallelism`.

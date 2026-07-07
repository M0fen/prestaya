# Ensayo offline del cobrador (modo avión) — checklist

Objetivo: probar que un cobrador puede registrar cobros **sin señal** y que al
volver la conexión se sincronizan **sin duplicar plata**. El mecanismo:
`lib/cobrador/colaOffline.ts` (cola en localStorage con `op_id` por operación) +
`lib/cobrador/useSync.ts` (vacía la cola al volver online) + índice único de la
migración `0006` (dedupe exactly-once en el servidor).

> Cubierto por tests: `colaOffline.test.ts` (la cola) y
> `pagos.idempotencia.test.ts` (el dedupe en el servidor). Este ensayo verifica
> el flujo real en el teléfono, que los tests no pueden simular.

## Preparación
1. Instalá la PWA en un teléfono real (o usá Chrome DevTools → dispositivo).
2. Entrá como **cobrador** con clientes asignados que tengan crédito activo.
3. Abrí la app **con señal** una vez (para cachear la app y cargar la ruta).

## Prueba A — cobro offline se encola
1. Activá **modo avión** (o DevTools → Network → *Offline*).
2. Abrí un cliente y registrá un **pago** (monto o cuota).
3. ✔️ Esperado: el pago se guarda igual, aparece el **badge de pendientes**
   (contador ≥ 1) y NO tira error de red. El comprobante muestra la hora real.
4. Registrá un **no-pago** en otro cliente (motivo: "no estaba").
5. ✔️ Esperado: badge de pendientes = 2.
6. Cerrá y reabrí la app **sin señal**.
7. ✔️ Esperado: los 2 pendientes **siguen ahí** (persisten en localStorage).

## Prueba B — sincroniza al volver online (sin duplicar)
1. Desactivá el modo avión (volvé a tener señal).
2. ✔️ Esperado: en segundos el badge baja a **0** (auto-flush), y los cobros
   aparecen ya registrados en el cartón del cliente y en la caja del admin.
3. En `/admin/cobranza` y en la ficha del cliente, verificá que cada cobro
   figura **una sola vez**, con la **hora en que se registró offline** (no la de
   la sincronización).

## Prueba C — corte de red a mitad de sincronización
1. Encolá 3 cobros en modo avión.
2. Volvé a tener señal y, apenas empiece a sincronizar, cortá la red de nuevo.
3. Volvé a tener señal.
4. ✔️ Esperado: al final, los 3 quedan registrados **una sola vez** cada uno
   (el `op_id` evita que un reintento duplique lo ya insertado).

## Prueba D — error de negocio no se pierde
1. En modo avión, registrá un cobro para un cliente **sin crédito activo** (si
   tenés uno así) o forzá el caso.
2. Volvé a tener señal.
3. ✔️ Esperado: esa op **no se borra**; queda como pendiente con intentos > 0
   (para revisarla), sin trabar la sincronización de las demás.

## Si algo falla
- El badge no baja: revisá `useSync` (evento `online`) y que la Server Action
  responda `ok`.
- Un cobro aparece **duplicado**: revisá que el `op_id` viaje en el insert y que
  el índice único de `0006` esté aplicado en la base.
- Se pierde un cobro offline: revisá `localStorage["py_cola_cobros"]` en el
  dispositivo (ahí viven los pendientes).

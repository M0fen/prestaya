-- ─────────────────────────────────────────────────────────────────────────
-- 0136 · CAPITAL COLOCADO en la rendición de la jornada
--
-- El cobrador que renueva o vende en la calle pone ESE efectivo de su bolsillo.
-- Al cerrar la jornada no lo tiene, así que no puede entregarlo:
--     esperado = base + recaudado − gastos − colocado
--
-- Faltaba, y el día 2 del piloto JUAN JOSÉ CASTRO no pudo cerrar: base $48.733 +
-- cobrado $49.320 = $98.053, pero había colocado $40.000 en 3 renovaciones, así
-- que en la mano tenía $58.053. La app le pedía $98.053 y le marcaba un faltante
-- de $40.000 que no existía.
--
-- La app ya lo DERIVA de `prestamos` (lib/data/colocado.ts). Esta migración lo
-- CONGELA en la fila, que es lo que hace falta para tres cosas que la derivación
-- no puede dar:
--   1. Que la fila de rendición sea coherente consigo misma. Hoy
--      `base + recaudado − gastos − entregado ≠ diferencia`, y los consumidores
--      que recomputan el esperado (cierre por zona, vigilancia, liquidación)
--      contradicen a la `diferencia` que el cobrador firmó.
--   2. Que el resumen de una jornada YA CERRADA no se mueva solo: si el cobrador
--      renueva a alguien después de rendir, el recalculado en vivo cambiaba el
--      "a entregar" de un acta firmada.
--   3. Trazabilidad: si un crédito se borra o se corrige después, la rendición
--      sigue explicando por qué se recibió ese efectivo.
--
-- Es ADITIVA y con default 0: sin correrla la app funciona igual (deriva).
-- ─────────────────────────────────────────────────────────────────────────

alter table rendiciones
  add column if not exists colocado numeric(12,2) not null default 0
    check (colocado >= 0);

alter table rendiciones
  add column if not exists creditos_colocados integer not null default 0
    check (creditos_colocados >= 0);

comment on column rendiciones.colocado is
  'Capital que el cobrador entregó en la calle ese día (renovaciones + ventas). '
  'Sale de su bolsillo: baja el efectivo que debe rendir. Congelado al cerrar.';
comment on column rendiciones.creditos_colocados is
  'Cuántos créditos dio de alta en la calle ese día (para poder mostrar el detalle).';

-- ── BACKFILL de las rendiciones ya cerradas ──────────────────────────────
-- Se deriva de `prestamos.creado_por` + el día UY de `creado_en`, exactamente
-- igual que lo calcula la app. Solo toca filas que hoy están en 0 (idempotente:
-- correrla dos veces no cambia nada la segunda vez).
--
-- ⚠️ NO se toca `diferencia`: es lo que el cobrador firmó y el libro es inmutable.
-- Lo que el backfill arregla es que de acá en adelante el ESPERADO recomputado
-- coincida con esa diferencia, en vez de contradecirla.
with colocado_dia as (
  select
    p.creado_por                                      as cobrador_id,
    (p.creado_en at time zone 'America/Montevideo')::date as fecha,
    round(sum(p.monto_prestado))                      as monto,
    count(*)                                          as cantidad
  from prestamos p
  where p.creado_por is not null
  group by 1, 2
)
update rendiciones r
   set colocado           = c.monto,
       creditos_colocados = c.cantidad
  from colocado_dia c
 where r.cobrador_id = c.cobrador_id
   and r.fecha       = c.fecha
   and r.colocado    = 0
   and c.monto       > 0;

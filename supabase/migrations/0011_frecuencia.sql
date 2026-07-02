-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — MODALIDADES de crédito (frecuencia de las cuotas).
--  Ejecutar en el SQL Editor DESPUÉS de 0010. Re-ejecutable.
--
--  Hasta ahora todos los créditos eran de cobro DIARIO. Se agrega `frecuencia`
--  para soportar cuotas semanales, quincenales o mensuales. Los créditos
--  existentes quedan en 'diario' (comportamiento idéntico al actual). El cálculo
--  del cartón (lib/cartones.ts) usa la frecuencia para ubicar la fecha de cada
--  cuota; `total_dias` pasa a significar "cantidad de cuotas".
-- ─────────────────────────────────────────────────────────────────────────

alter table prestamos
  add column if not exists frecuencia text not null default 'diario'
    check (frecuencia in ('diario','semanal','quincenal','mensual'));

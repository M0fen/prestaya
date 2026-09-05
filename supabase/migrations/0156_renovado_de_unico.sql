-- ─────────────────────────────────────────────────────────────────────────
--  0156 · UN CRÉDITO SE RENUEVA UNA SOLA VEZ — ahora lo dice la base
--
--  `prestamos.renovado_de` tenía índice, pero NO único. La garantía de que un
--  crédito no se renueva dos veces la sostenía una consulta de JavaScript
--  (`buscarRenovacion`, siete `.eq()` encadenados) más el gate `estado='activo'`
--  del UPDATE que finaliza el anterior. Funciona, pero es una garantía de código:
--  cualquier camino nuevo que inserte un préstamo con `renovado_de` puede
--  duplicar el linaje sin que nada lo frene.
--
--  Y las renovaciones NO llevan `op_id`: de las 221 altas nativas de agosto, 176
--  son renovaciones y solo 45 tienen clave de idempotencia. O sea que el índice
--  único del `op_id` tampoco las cubre.
--
--  ALCANCE REAL DEL CAMBIO: CERO. Medido sobre los 14.918 créditos, no hay ni un
--  `renovado_de` con dos hijos, así que el índice se crea sin tocar una fila.
--  Parcial (`where renovado_de is not null`) porque la enorme mayoría de los
--  créditos no son renovación y los NULL no deben competir entre sí.
-- ─────────────────────────────────────────────────────────────────────────
create unique index if not exists prestamos_renovado_de_uidx
  on prestamos (renovado_de)
  where renovado_de is not null;

comment on index prestamos_renovado_de_uidx is
  'Un crédito se renueva UNA sola vez. Antes lo sostenía solo el código; las '
  'renovaciones ni siquiera llevan op_id, así que no había candado de base.';

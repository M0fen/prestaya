-- ─────────────────────────────────────────────────────────────────────────
--  0085 · ÍNDICE de performance — pagos por (registrado_por, registrado_en)
--
--  QUÉ HACE: acelera el camino MÁS usado del sistema. "Mis números" de cada
--  cobrador y varios reportes (desempeño, vigilancia, recaudo por vendedor)
--  filtran los pagos por QUIÉN los registró, acotado por fecha. Hoy NO existe
--  índice por `registrado_por`: con el tiempo (cientos de miles de pagos) cada
--  consulta escanea un mes entero de filas para devolver unas pocas. Este índice
--  las va a buscar directo. NO cambia ningún dato ni ninguna plata — solo velocidad.
--
--  ⚠️ IMPORTANTE — CORRÉ ESTE ARCHIVO SOLO (nada más pegado junto):
--     `CREATE INDEX CONCURRENTLY` construye el índice SIN bloquear la tabla (se
--     puede correr con la app EN VIVO), pero NO puede ir dentro de una transacción.
--     Si al ejecutarlo el editor tira el error
--       "CREATE INDEX CONCURRENTLY cannot run inside a transaction block",
--     usá la ALTERNATIVA de abajo (comentada) en un momento de poco movimiento.
--
--  Re-ejecutable (IF NOT EXISTS). Puede tardar; no pasa nada, la app sigue andando.
-- ─────────────────────────────────────────────────────────────────────────

create index concurrently if not exists idx_pagos_registrador_fecha
  on pagos (registrado_por, registrado_en)
  where anulado = false;

-- ── ALTERNATIVA (solo si la de arriba dio error de "transaction block") ──────
-- Sin CONCURRENTLY: bloquea las escrituras de `pagos` unos segundos mientras se
-- construye. Corré esto en un horario de poco movimiento (ej. temprano o de noche).
-- create index if not exists idx_pagos_registrador_fecha
--   on pagos (registrado_por, registrado_en)
--   where anulado = false;

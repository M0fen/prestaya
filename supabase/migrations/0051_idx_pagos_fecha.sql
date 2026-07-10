-- ─────────────────────────────────────────────────────────────────────────
--  0051 · ÍNDICE por FECHA en pagos. Faltaba: los únicos índices de `pagos` eran
--  por prestamo_id / op_id / disapp_id. Toda consulta "pagos desde X"
--  (recaudo hoy/mes, /admin/valor, rendiciones, RPCs de sumas/conteos) hacía un
--  SEQ SCAN de ~158k filas → statement timeout (57014) en /admin/valor y
--  cold-starts lentos en el dashboard. Parcial sobre los VIGENTES (anulado=false),
--  que es como filtran casi todas esas consultas. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_pagos_reg_en_vig
  on pagos (registrado_en)
  where anulado = false;

-- Refresca stats para que el planner use el índice nuevo de una.
analyze pagos;

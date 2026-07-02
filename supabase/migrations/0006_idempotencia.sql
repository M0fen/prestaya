-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — IDEMPOTENCIA de cobros/visitas offline.
--  La app del cobrador registra sin señal y sincroniza después (cola offline).
--  Cada operación trae un `op_id` (uuid del dispositivo). El índice único evita
--  duplicar un cobro si un flush se corta DESPUÉS de insertar en la base.
--  Ejecutar en el SQL Editor. Re-ejecutable.
--
--  Tras aplicar: se activa el envío de `op_id` en las Server Actions del
--  cobrador (hoy no se manda porque la columna aún no existe) para lograr
--  exactly-once. Sin esto, la cola es at-least-once (riesgo bajo de duplicado).
-- ─────────────────────────────────────────────────────────────────────────

alter table pagos   add column if not exists op_id uuid;
alter table visitas add column if not exists op_id uuid;

create unique index if not exists uniq_pagos_op
  on pagos (op_id) where op_id is not null;
create unique index if not exists uniq_visitas_op
  on visitas (op_id) where op_id is not null;

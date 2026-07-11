-- ─────────────────────────────────────────────────────────────────────────
--  0065 — Índices de performance (auditoría Senior 2026-07-11).
--  Idempotente (create index if not exists). Correr por el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) visitas(registrado_en): "Cobranza" y "Mi jornada" del admin filtran las
--    visitas del día por fecha (control.ts / vigilancia.ts). Sin este índice era
--    un seq scan de toda la tabla `visitas` (crece al mismo ritmo que `pagos`).
--    Replica lo que 0051 hizo para `pagos(registrado_en)`.
create index if not exists idx_visitas_reg_en on visitas (registrado_en);

-- 2) mensajes(creado_en): el badge de "no leídos" (getTotalNoLeidos) ordena por
--    creado_en desc con LIMIT 1000 cruzando TODOS los ámbitos. Los índices que hay
--    son PARCIALES por ámbito (idx_mensajes_general/cobrador/zona/supervisores) y
--    no sostienen ese orden global → sort/scan en cada navegación de ambos layouts.
create index if not exists idx_mensajes_creado on mensajes (creado_en desc);

-- Refresca las estadísticas del planificador para que use los índices nuevos.
analyze visitas;
analyze mensajes;

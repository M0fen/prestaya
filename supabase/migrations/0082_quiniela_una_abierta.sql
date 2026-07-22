-- ─────────────────────────────────────────────────────────────────────────
--  0082 · QUINIELA: a lo sumo UNA abierta a la vez (candado a nivel BD).
--
--  El código ya cierra las abiertas antes de abrir una nueva (crearQuinielaDb),
--  pero dos gestores abriendo casi a la vez podían dejar DOS filas 'abierta'
--  (carrera read-then-insert). Este índice único PARCIAL lo hace imposible: el
--  2º insert concurrente choca con 23505 y el código reintenta (cerrar+abrir).
--
--  Ejecutar en el SQL Editor. Re-ejecutable. (Requiere que hoy no haya más de
--  una quiniela 'abierta'; si hubiera, cerrá las viejas antes de correrlo.)
-- ─────────────────────────────────────────────────────────────────────────
create unique index if not exists idx_quiniela_una_abierta
  on quinielas (estado)
  where estado = 'abierta';

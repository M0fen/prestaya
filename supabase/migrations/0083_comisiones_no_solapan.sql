-- ─────────────────────────────────────────────────────────────────────────
--  0083 · COMISIONES: candado ATÓMICO anti-doble-pago por cadencias solapadas.
--
--  La guardia JS (read-then-insert) frena el caso SECUENCIAL, pero dos
--  liquidaciones CONCURRENTES de cadencias que se cruzan (día ⊂ semana ⊂ mes ⊂
--  año) podían leer la tabla antes de que la otra insertara → doble egreso de la
--  misma comisión. Este EXCLUDE lo hace IMPOSIBLE a nivel base: para un mismo
--  cobrador, dos rangos de fecha que se cruzan no pueden coexistir.
--
--  · `periodo_rango` es un daterange [desde, hasta) (upper EXCLUSIVO): dos días
--    adyacentes NO se solapan, pero día ⊂ mes SÍ (igual que rangosSeSolapan).
--  · Constraint PARCIAL (solo filas con rango) → NO requiere backfill de las
--    filas viejas (quedan con rango null); la guardia JS las sigue cubriendo.
--  · El app inserta el rango y trata 23P01 (exclusion_violation) como "solapa";
--    si esta migración aún no corrió, degrada solo (inserta sin rango).
--
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create extension if not exists btree_gist;

alter table comisiones_liquidadas add column if not exists periodo_rango daterange;

alter table comisiones_liquidadas drop constraint if exists comisiones_no_solapan;
alter table comisiones_liquidadas
  add constraint comisiones_no_solapan
  exclude using gist (cobrador_id with =, periodo_rango with &&)
  where (periodo_rango is not null);

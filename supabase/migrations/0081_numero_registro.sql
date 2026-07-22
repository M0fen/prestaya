-- ─────────────────────────────────────────────────────────────────────────
--  0081 · NÚMERO DE REGISTRO del cliente (correlativo) + base de la QUINIELA.
--
--  Cada cliente tiene un número correlativo estable. Los ÚLTIMOS 3 dígitos son
--  su "número de la suerte" de la quiniela (asignado, NO elegido). Base 1000 →
--  todos tienen al menos 3 dígitos y los últimos-3 quedan bien formados.
--
--  Ejecutar en el SQL Editor. Re-ejecutable (backfilea solo los que faltan).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) La columna (nullable al principio para poder backfillear).
alter table clientes add column if not exists numero_registro bigint;

-- 2) Backfill en ORDEN de alta (el más antiguo, número más bajo). Solo los que
--    aún no tienen (re-ejecutable). Base 1000.
with orden as (
  select id, row_number() over (order by creado_en asc, id asc) as rn
  from clientes
  where numero_registro is null
)
update clientes c
set numero_registro = 1000 + o.rn
from orden o
where c.id = o.id and c.numero_registro is null;

-- 3) Secuencia para los NUEVOS clientes, arrancando después del máximo actual.
do $$
declare maxn bigint;
begin
  select coalesce(max(numero_registro), 1000) into maxn from clientes;
  if not exists (select 1 from pg_class where relname = 'clientes_nro_registro_seq') then
    execute format('create sequence clientes_nro_registro_seq start %s', maxn + 1);
  else
    -- Ya existe: la dejamos apuntando al máximo (el próximo nextval da max+1).
    perform setval('clientes_nro_registro_seq', maxn);
  end if;
end $$;

alter table clientes alter column numero_registro set default nextval('clientes_nro_registro_seq');

-- 4) Unicidad (después del backfill, así no choca).
create unique index if not exists idx_clientes_numero_registro on clientes (numero_registro);

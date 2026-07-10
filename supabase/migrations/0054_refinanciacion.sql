-- ─────────────────────────────────────────────────────────────────────────
--  0054 · REFINANCIACIÓN (cuadre con Disapp)
--
--  Contexto (verificado 2026-07-10 contra el PDF "Cartera por Cliente" de Disapp,
--  autoritativo, $68.544.105,68 exacto): el import trae 2.754 créditos "Activo"
--  ($94,3M de saldo) pero la cartera REAL de Disapp es $68,5M / 2.413 créditos.
--  El gap de $25,76M / 341 créditos son REFINANCIACIONES a 0%: cada refi crea un
--  crédito nuevo "Activo" SIN cerrar el viejo en el export → sumar el export los
--  cuenta dos veces. Disapp los netea; nuestro import no. (Ver
--  memory/refinanciacion-cuadre.md — corrige la conclusión previa "Disapp esconde
--  cartera", que era ERRÓNEA.)
--
--  Prueba: INO CURBELO — 3 créditos semanales / $3,8M en nuestro sistema vs
--  $1.425.000 en Disapp. El de $1,7M con $0 pagado es un fantasma de refi.
--  Money-critical: cobrar nuestro número = cobrar de más al deudor (regla de oro).
--
--  ESTE archivo = solo el ESQUEMA (aditivo, reversible). El MARCADO de los créditos
--  (regla R2) va aparte en scripts/marcar-refinanciaciones.sql — correr DESPUÉS de
--  revisar. Re-ejecutable. Correr en el SQL Editor.
--
--  Diseño: un crédito refinanciado NO es deuda activa (el saldo lo carga el crédito
--  más nuevo). Se marca con estado='refinanciado' — así TODAS las superficies que ya
--  filtran estado='activo' (dashboard app_cartera_activa, ruta del cobrador, mora,
--  estadísticas) lo excluyen SOLAS, sin tocar código. Los pagos NO se tocan (libro
--  inmutable); el crédito queda visible en el historial de la ficha.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Ampliar el CHECK de prestamos.estado para permitir 'refinanciado'.
--    Drop robusto de cualquier check sobre `estado` (sin depender del nombre) + re-add.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'prestamos' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%estado%'
  loop
    execute format('alter table prestamos drop constraint %I', c.conname);
  end loop;
end $$;

alter table prestamos add constraint prestamos_estado_check
  check (estado in ('activo','finalizado','cancelado','incobrable','refinanciado'));

-- 2) Trazabilidad: cuándo se marcó como refinanciado (NULL = no refinanciado).
alter table prestamos add column if not exists refinanciado_en timestamptz;
comment on column prestamos.refinanciado_en is
  'Instante en que se marcó estado=refinanciado (rollover 0% doble-contado en el import Disapp). NULL = no refinanciado.';

-- 3) Índice parcial para listar refinanciados barato (para el conteo de transparencia).
create index if not exists idx_prestamos_refinanciados
  on prestamos (cliente_id) where (estado = 'refinanciado');

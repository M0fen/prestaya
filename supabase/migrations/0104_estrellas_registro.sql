-- ─────────────────────────────────────────────────────────────────────────
-- 0104 — ESTRELLAS: registro de redención más completo (folio + entrega + premio).
--
-- Hasta hoy una redención solo guardaba el CONTEO de estrellas + estado (aprobada/
-- rechazada). Faltaba: (a) un FOLIO verificable (nº de serie, como la raspadita
-- 0097), (b) separar la DECISIÓN (aprobar) de la ENTREGA física del premio, y
-- (c) qué premio se entregó. Esto lo agrega, sin tocar el núcleo (las estrellas se
-- siguen DERIVANDO de los pagos; solo las redenciones se persisten).
--
--  · folio: nº único, asignado por TRIGGER al pasar a 'aprobada' (insert-aprobada o
--    update pendiente→aprobada). Los rechazos no llevan folio.
--  · premio_texto: qué se entregó (opcional).
--  · entregado / entregado_en / entregado_por: la entrega REAL del premio, aparte
--    de la aprobación (el admin marca "entregado" cuando el cliente lo recibe).
--
-- Inmutabilidad: la tabla ya no tiene DELETE y el UPDATE es solo de gestor (0020).
-- Correr en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

alter table estrellas_redenciones add column if not exists folio         bigint;
alter table estrellas_redenciones add column if not exists premio_texto   text;
alter table estrellas_redenciones add column if not exists entregado      boolean not null default false;
alter table estrellas_redenciones add column if not exists entregado_en   timestamptz;
alter table estrellas_redenciones add column if not exists entregado_por  uuid references usuarios(id);

create sequence if not exists estrellas_folio_seq;
-- Un folio no se repite (los null no cuentan en un índice único parcial).
create unique index if not exists uniq_estrellas_folio on estrellas_redenciones (folio) where folio is not null;

-- Asigna el folio automáticamente cuando la redención queda 'aprobada' (y aún no
-- tiene). Corre en INSERT (canje directo, ya aprobado) y en UPDATE (aprobar una
-- pendiente). Un rechazo nunca recibe folio.
create or replace function estrellas_asignar_folio() returns trigger
language plpgsql as $$
begin
  if new.estado = 'aprobada' and new.folio is null then
    new.folio := nextval('estrellas_folio_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_estrellas_folio on estrellas_redenciones;
create trigger trg_estrellas_folio
  before insert or update on estrellas_redenciones
  for each row execute function estrellas_asignar_folio();

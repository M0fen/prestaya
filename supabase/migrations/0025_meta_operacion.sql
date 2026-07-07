-- ─────────────────────────────────────────────────────────────────────────
--  0025 · META de operación (objetivo de recaudo MENSUAL).
--  Una sola fila (id=1). Es un objetivo del negocio (no toca dinero real): el
--  Cierre del día lo usa para mostrar avance y proyección vs meta. La fija el
--  equipo (gestor). Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists config_operacion (
  id                    int primary key default 1 check (id = 1),
  meta_recaudo_mensual  numeric(14,2) not null default 0 check (meta_recaudo_mensual >= 0),
  actualizado_por       uuid references usuarios(id),
  actualizado_en        timestamptz not null default now()
);

alter table config_operacion enable row level security;

drop policy if exists config_operacion_select on config_operacion;
drop policy if exists config_operacion_write on config_operacion;

-- Los gestores ven y fijan la meta (es un objetivo, no un movimiento de caja).
create policy config_operacion_select on config_operacion for select to authenticated
  using ( app_es_gestor() );
create policy config_operacion_write on config_operacion for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

insert into config_operacion (id) values (1) on conflict (id) do nothing;

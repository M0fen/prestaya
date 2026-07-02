-- ─────────────────────────────────────────────────────────────────────────
--  0018 · GAMING PRO — recompensas reales + temporadas.
--  · `recompensas`: premios que el admin define, ligados a HITOS de pago
--    (racha / mes al día / crédito 100% / nivel). El cliente ve su cofre y qué
--    le falta. Se desbloquean solos con el comportamiento real (no se trucan).
--  · Temporada: campos nuevos en `ajustes_juego` (tema del mes + meta colectiva
--    + premio). Ejecutar en el SQL Editor DESPUÉS de 0009. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Recompensas ────────────────────────────────────────────────────────────
create table if not exists recompensas (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  premio     text not null,
  hito_tipo  text not null check (hito_tipo in ('racha','mes_al_dia','credito_completo','nivel')),
  hito_valor int not null default 0,
  activo     boolean not null default true,
  orden      int not null default 0,
  creado_en  timestamptz not null default now()
);

alter table recompensas enable row level security;
drop policy if exists recompensas_select on recompensas;
drop policy if exists recompensas_write on recompensas;
-- Gestores gestionan; la vista de cliente lee por service_role (ignora RLS).
create policy recompensas_select on recompensas for select to authenticated using ( app_es_gestor() );
create policy recompensas_write  on recompensas for all    to authenticated using ( app_es_gestor() ) with check ( app_es_gestor() );

-- Recompensas de arranque (solo si la tabla está vacía).
insert into recompensas (titulo, premio, hito_tipo, hito_valor, orden)
select v.titulo, v.premio, v.hito_tipo, v.hito_valor, v.orden
from (values
  ('Primera semana',  'Vas de fiar: seguimos sumando juntos',   'racha',            7,  1),
  ('Racha de 15',     'Descuento en tu próximo crédito',         'racha',            15, 2),
  ('Mes sin atrasos', 'Entrás al sorteo del mes',                'mes_al_dia',       0,  3),
  ('Crédito al 100%', 'Mejor tasa en tu renovación',             'credito_completo', 0,  4)
) as v(titulo, premio, hito_tipo, hito_valor, orden)
where not exists (select 1 from recompensas);

-- ── Temporada (sobre la config única del gaming) ───────────────────────────
alter table ajustes_juego add column if not exists temporada_activa  boolean not null default false;
alter table ajustes_juego add column if not exists temporada_nombre  text    not null default '';
alter table ajustes_juego add column if not exists temporada_emoji   text    not null default '🏆';
alter table ajustes_juego add column if not exists temporada_meta    int     not null default 90;
alter table ajustes_juego add column if not exists temporada_premio  text    not null default '';

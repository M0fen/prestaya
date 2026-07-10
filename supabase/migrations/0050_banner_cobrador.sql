-- ─────────────────────────────────────────────────────────────────────────
--  0050 · BANNER AL EQUIPO. Aviso corto que el admin/supervisor envía a la app
--  del cobrador (arriba de su ruta). No es chat: es un cartel fijo mientras esté
--  activo (feriado, cambio de zona, recordatorio de rendición, etc.).
--  Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists banner_cobrador (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null,
  tema        text not null default 'azul' check (tema in ('azul', 'verde', 'ambar', 'rojo')),
  activo      boolean not null default true,
  creado_por  uuid references usuarios(id),
  creado_en   timestamptz not null default now(),
  -- Opcional: se apaga solo después de esta fecha (null = hasta que lo apaguen).
  expira_en   timestamptz
);

create index if not exists idx_banner_cob_activo on banner_cobrador (activo, creado_en desc);

alter table banner_cobrador enable row level security;

-- Gestores: gestionan todo (crear/apagar/listar). Cualquier usuario interno
-- (cobrador incluido): SOLO lee los banners ACTIVOS. Las policies del mismo
-- comando se combinan con OR, así que el gestor lee todo y el cobrador los activos.
drop policy if exists banner_cob_gestor on banner_cobrador;
create policy banner_cob_gestor on banner_cobrador
  for all to authenticated using ( app_es_gestor() ) with check ( app_es_gestor() );

drop policy if exists banner_cob_leer on banner_cobrador;
create policy banner_cob_leer on banner_cobrador
  for select to authenticated using ( activo = true );

-- ─────────────────────────────────────────────────────────────────────────
--  0026 · Suscripciones de PUSH (avisos internos: admin/supervisor/cobrador).
--  Guarda la PushSubscription del navegador de cada usuario (una por device).
--  Los avisos son INTERNOS (no clientes). El envío lo hace el servidor
--  (service_role) con las claves VAPID. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  creado_en   timestamptz not null default now()
);

create index if not exists push_suscripciones_usuario on push_suscripciones(usuario_id);

alter table push_suscripciones enable row level security;

drop policy if exists push_susc_select on push_suscripciones;
drop policy if exists push_susc_write on push_suscripciones;

-- Cada usuario administra SOLO sus propias suscripciones. El envío server-side
-- usa service_role (bypassa RLS) para leer las de todos.
create policy push_susc_select on push_suscripciones for select to authenticated
  using ( usuario_id = app_usuario_id() );
create policy push_susc_write on push_suscripciones for all to authenticated
  using ( usuario_id = app_usuario_id() ) with check ( usuario_id = app_usuario_id() );

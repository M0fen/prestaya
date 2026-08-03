-- ─────────────────────────────────────────────────────────────────────────
--  SHIM de Supabase para TESTS DE INTEGRACIÓN contra un Postgres "pelado".
--  NO se usa en producción. Recrea los objetos que Supabase provee de fábrica
--  (roles, schema `auth`, `auth.uid()`, `storage`, publicación realtime) para
--  que las migraciones REALES de producción (supabase/migrations/*.sql) carguen
--  SIN modificaciones en un clúster efímero. Así los tests ejercitan el MISMO
--  SQL que corre en Supabase (RPCs, triggers, RLS), no una reimplementación.
--
--  Identidad: `auth.uid()` lee un GUC de sesión (request.jwt.claim.sub) que el
--  harness fija por conexión con  `select set_config('request.jwt.claim.sub', $1, false)`
--  para simular "quién está logueado". Con eso las políticas RLS y los helpers
--  app_*() se comportan igual que en Supabase real.
-- ─────────────────────────────────────────────────────────────────────────

-- Roles que Supabase crea y a los que las migraciones hacen GRANT / policies.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'authenticator';
    grant anon, authenticated, service_role to authenticator;
  end if;
end $$;

-- Privilegios por DEFECTO como los de Supabase: en un proyecto real, TODAS las
-- tablas/secuencias creadas en `public` reciben GRANT para anon/authenticated/
-- service_role (la RLS es la que recorta después). Sin esto, un test que opera
-- como `authenticated` directo sobre una tabla (p. ej. los de triggers de
-- inmutabilidad) muere con 42501 antes de llegar al trigger/policy bajo prueba.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Extensión que la migración inicial (0001) asume disponible.
create extension if not exists pgcrypto;

-- ── Schema auth + identidad ────────────────────────────────────────────────
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- auth.uid(): id del usuario de LOGIN (auth.users.id). El harness lo fija por
-- conexión. Devuelve NULL si no hay sesión (comportamiento de Supabase).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- ── Schema storage (fotos): solo lo que tocan 0044/0045/0076 ────────────────
create schema if not exists storage;
create table if not exists storage.buckets (
  id         text primary key,
  name       text,
  public     boolean default false,
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- ── Publicación realtime (0008 la consulta y, si existe, agrega tablas) ─────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Acceso de los roles a los schemas (Supabase lo concede por default).
grant usage on schema auth    to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema public  to anon, authenticated, service_role;
grant execute on function auth.uid()  to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.jwt()  to anon, authenticated, service_role;

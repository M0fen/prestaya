-- ─────────────────────────────────────────────────────────────────────────
--  0030 · ZONAS (Fase A — cimiento del modelo por zona).
--  Ejecutar en el editor SQL de Supabase, DESPUÉS de 0029.
--
--  Modelo (decisiones fijadas con Carlos/Mauricio):
--   · Cada COBRADOR pertenece a UNA sola zona  → usuarios.zona_id.
--   · Un SUPERVISOR puede cubrir VARIAS zonas   → supervisor_zonas (N:M).
--   · El ADMIN ve todo (no tiene zona).
--   · La zona de un CLIENTE/PRÉSTAMO NO se guarda: se DERIVA del cobrador
--     asignado (misma filosofía que el cartón: se calcula, no se persiste).
--
--  Esta migración crea las tablas y su RLS. La reescritura de las políticas de
--  clientes/préstamos/pagos para restringir al supervisor por zona va en 0031
--  (Fase B) — así este paso es aditivo y no cambia la seguridad vigente.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- ZONAS (barrio / sector / ruta madre)
-- ─────────────────────────────────────────────
create table if not exists zonas (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  -- Color hex para el mapa y los chips de la UI (opcional).
  color          text,
  descripcion    text,
  activo         boolean not null default true,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists uniq_zonas_nombre on zonas (lower(nombre)) where (activo = true);

drop trigger if exists trg_zonas_actualizado on zonas;
create trigger trg_zonas_actualizado
  before update on zonas
  for each row execute function set_actualizado_en();

-- ─────────────────────────────────────────────
-- COBRADOR → ZONA (una sola). Columna en usuarios.
-- ─────────────────────────────────────────────
alter table usuarios add column if not exists zona_id uuid references zonas(id);
create index if not exists idx_usuarios_zona on usuarios (zona_id) where (zona_id is not null);

-- ─────────────────────────────────────────────
-- SUPERVISOR ↔ ZONAS (un supervisor cubre varias)
-- ─────────────────────────────────────────────
create table if not exists supervisor_zonas (
  supervisor_id uuid not null references usuarios(id) on delete cascade,
  zona_id       uuid not null references zonas(id)    on delete cascade,
  asignado_por  uuid references usuarios(id),
  asignado_en   timestamptz not null default now(),
  primary key (supervisor_id, zona_id)
);

create index if not exists idx_supzonas_sup  on supervisor_zonas (supervisor_id);
create index if not exists idx_supzonas_zona on supervisor_zonas (zona_id);

-- ─────────────────────────────────────────────
-- SEGURIDAD (RLS) de las tablas nuevas.
--   · zonas: todo gestor las lee; solo el ADMIN las crea/edita/borra.
--   · supervisor_zonas: todo gestor lee (para saber quién cubre qué);
--     solo el ADMIN asigna/quita (define fronteras).
--  (La restricción del supervisor a SUS zonas sobre datos de dinero es 0031.)
-- ─────────────────────────────────────────────
alter table zonas            enable row level security;
alter table supervisor_zonas enable row level security;

drop policy if exists zonas_select on zonas;
drop policy if exists zonas_insert on zonas;
drop policy if exists zonas_update on zonas;
drop policy if exists zonas_delete on zonas;

create policy zonas_select on zonas for select to authenticated
  using ( app_es_gestor() );
create policy zonas_insert on zonas for insert to authenticated
  with check ( app_rol() = 'admin' );
create policy zonas_update on zonas for update to authenticated
  using ( app_rol() = 'admin' ) with check ( app_rol() = 'admin' );
create policy zonas_delete on zonas for delete to authenticated
  using ( app_rol() = 'admin' );

drop policy if exists supzonas_select on supervisor_zonas;
drop policy if exists supzonas_insert on supervisor_zonas;
drop policy if exists supzonas_delete on supervisor_zonas;

create policy supzonas_select on supervisor_zonas for select to authenticated
  using ( app_es_gestor() );
create policy supzonas_insert on supervisor_zonas for insert to authenticated
  with check ( app_rol() = 'admin' );
create policy supzonas_delete on supervisor_zonas for delete to authenticated
  using ( app_rol() = 'admin' );

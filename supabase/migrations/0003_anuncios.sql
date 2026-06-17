-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — tabla de ANUNCIOS (banner gestionable por admin/supervisor).
--  Ejecutar en el SQL Editor de Supabase DESPUÉS de 0001 y 0002.
--
--  Mauricio o su esposa cargan un anuncio y se muestra en la vista de cliente
--  sin tocar código. Se puede programar por fechas, priorizar y segmentar
--  según el estado del crédito del cliente.
--  Re-ejecutable: borra políticas/trigger antes de recrearlos.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists anuncios (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  cuerpo         text,
  cta_texto      text,                 -- texto del botón (opcional)
  cta_url        text,                 -- enlace del botón (opcional)
  imagen_url     text,                 -- imagen/ilustración (opcional)
  tema           text not null default 'azul'
                 check (tema in ('azul','verde','ambar','oscuro')),
  prioridad      int  not null default 0,   -- mayor = se muestra primero
  activo         boolean not null default true,
  -- A quién se le muestra, según el estado de su crédito.
  segmento       text not null default 'todos'
                 check (segmento in ('todos','al_dia','con_pendientes')),
  fecha_inicio   timestamptz not null default now(),
  fecha_fin      timestamptz,          -- null = sin vencimiento
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Si hay fecha_fin, debe ser posterior al inicio.
  constraint chk_anuncio_fechas check (fecha_fin is null or fecha_fin > fecha_inicio)
);

-- Índice para la consulta "anuncio activo a mostrar ahora".
create index if not exists idx_anuncios_vigentes
  on anuncios (activo, prioridad desc, fecha_inicio desc);

-- Mantener actualizado_en (función creada en 0001_inicial.sql).
drop trigger if exists trg_anuncios_actualizado on anuncios;
create trigger trg_anuncios_actualizado
  before update on anuncios
  for each row execute function set_actualizado_en();

-- ─────────────────────────────────────────────
-- SEGURIDAD (RLS): solo gestores administran; los logueados leen los activos.
-- La vista de cliente los lee vía servidor (service role, ignora RLS).
-- ─────────────────────────────────────────────
alter table anuncios enable row level security;

drop policy if exists anuncios_select on anuncios;
drop policy if exists anuncios_insert on anuncios;
drop policy if exists anuncios_update on anuncios;
drop policy if exists anuncios_delete on anuncios;

create policy anuncios_select on anuncios for select to authenticated
  using ( app_es_gestor() or activo = true );
create policy anuncios_insert on anuncios for insert to authenticated
  with check ( app_es_gestor() );
create policy anuncios_update on anuncios for update to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );
create policy anuncios_delete on anuncios for delete to authenticated
  using ( app_es_gestor() );

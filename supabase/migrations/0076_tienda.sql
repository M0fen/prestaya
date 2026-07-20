-- ─────────────────────────────────────────────────────────────────────────
-- 0076 — TIENDA de productos a crédito.
--
-- El cliente ve un CATÁLOGO (galería por categorías) en su cartón + un BANNER del
-- producto destacado; toca "Me interesa" → le llega al admin como LEAD (NO genera
-- crédito automático). El admin gestiona productos, categorías, medios (fotos en
-- carrusel + video), y puede fijar precio/interés/cuotas POR CLIENTE.
--
-- Money: precio/interés son numeric (NUNCA float). El cartón/crédito NO se toca
-- desde acá: la tienda solo publica y capta interés; el crédito lo arma el admin.
--
-- Migraciones las corre Carlos en el SQL Editor. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) CATEGORÍAS (el admin las gobierna: alta, orden, activar).
create table if not exists categorias_producto (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  orden       int  not null default 0,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- 2) PRODUCTOS. `fotos` es un array de URLs (la 1ª es la portada; el resto arma el
--    carrusel). `video_url` opcional. `destacado` → sale como banner en el cartón.
create table if not exists productos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  descripcion    text,
  categoria_id   uuid references categorias_producto(id) on delete set null,
  precio         numeric(12,2) not null default 0,   -- precio base (UYU)
  interes_pct    numeric(5,2)  not null default 0,    -- % de interés base
  cuotas         int not null default 0,              -- nº de cuotas sugerido (0 = s/d)
  frecuencia     text not null default 'diario',      -- diario | semanal | quincenal | mensual
  fotos          text[] not null default '{}',        -- URLs (1ª = portada); carrusel
  video_url      text,                                 -- opcional
  activo         boolean not null default true,        -- visible en la tienda del cliente
  destacado      boolean not null default false,       -- banner en el cartón
  orden          int not null default 0,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists idx_productos_activo on productos (activo, orden);
create index if not exists idx_productos_categoria on productos (categoria_id);

-- 3) PRECIO POR CLIENTE (override): el admin le fija a un cliente puntual otro
--    precio/interés/cuotas para el mismo producto. UNIQUE (producto, cliente).
create table if not exists producto_precio_cliente (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id) on delete cascade,
  cliente_id   uuid not null references clientes(id) on delete cascade,
  precio       numeric(12,2) not null,
  interes_pct  numeric(5,2)  not null default 0,
  cuotas       int not null default 0,
  nota         text,
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now(),
  unique (producto_id, cliente_id)
);
create index if not exists idx_precio_cliente_prod on producto_precio_cliente (producto_id, cliente_id);

-- 4) SOLICITUDES (leads): el cliente toca "Me interesa". Snapshot del nombre del
--    producto por si se borra/renombra. El write del cliente entra por service_role
--    (Server Action que valida el token), como ReportarDiscrepancia.
create table if not exists solicitudes_producto (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid references productos(id) on delete set null,
  cliente_id       uuid not null references clientes(id) on delete cascade,
  producto_nombre  text not null,
  estado           text not null default 'nueva',   -- nueva | contactado | cerrada | descartada
  nota             text,
  creado_en        timestamptz not null default now(),
  resuelto_por     uuid references usuarios(id),
  resuelto_en      timestamptz
);
create index if not exists idx_solic_prod_estado on solicitudes_producto (estado, creado_en desc);
create index if not exists idx_solic_prod_cliente on solicitudes_producto (cliente_id, creado_en desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Los gestores LEEN; solo el ADMIN escribe (la tienda es del dueño). La vista del
-- CLIENTE lee con service_role (que saltea RLS) tras validar el token en el server.
alter table categorias_producto     enable row level security;
alter table productos                enable row level security;
alter table producto_precio_cliente  enable row level security;
alter table solicitudes_producto     enable row level security;

do $$
begin
  -- categorías
  drop policy if exists cat_prod_select on categorias_producto;
  drop policy if exists cat_prod_write  on categorias_producto;
  create policy cat_prod_select on categorias_producto for select to authenticated using ( app_es_gestor() );
  create policy cat_prod_write  on categorias_producto for all    to authenticated using ( app_es_admin() ) with check ( app_es_admin() );

  -- productos
  drop policy if exists productos_select on productos;
  drop policy if exists productos_write  on productos;
  create policy productos_select on productos for select to authenticated using ( app_es_gestor() );
  create policy productos_write  on productos for all    to authenticated using ( app_es_admin() ) with check ( app_es_admin() );

  -- precio por cliente (sensible: solo admin)
  drop policy if exists precio_cli_all on producto_precio_cliente;
  create policy precio_cli_all on producto_precio_cliente for all to authenticated using ( app_es_admin() ) with check ( app_es_admin() );

  -- solicitudes (leads): gestor las lee/gestiona; el INSERT del cliente entra por service_role.
  drop policy if exists solic_prod_select on solicitudes_producto;
  drop policy if exists solic_prod_update on solicitudes_producto;
  create policy solic_prod_select on solicitudes_producto for select to authenticated using ( app_es_gestor() );
  create policy solic_prod_update on solicitudes_producto for update to authenticated using ( app_es_gestor() ) with check ( app_es_gestor() );
end $$;

-- ── Bucket de Storage para fotos/videos de la tienda (público, solo lectura) ──
insert into storage.buckets (id, name, public)
values ('tienda', 'tienda', true)
on conflict (id) do nothing;

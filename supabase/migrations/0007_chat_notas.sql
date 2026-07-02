-- ─────────────────────────────────────────────────────────────────────────
--  Presta Ya — CHAT interno + NOTAS (comunicación de la operación).
--  Ejecutar en el SQL Editor DESPUÉS de 0001–0006. Re-ejecutable.
--
--  · mensajes         → chat interno. Dos ámbitos:
--      - 'general'  : hilo único del equipo (todos los internos).
--      - 'cobrador' : hilo privado gestor ↔ un cobrador (cobrador_id).
--  · chat_lecturas    → última lectura por usuario y canal (badge de no leídos).
--  · notas_cliente    → notas por cliente, visibles para el equipo del cliente.
--  · notas_personales → bloc privado de cada usuario.
--
--  Todo pasa por RLS (usuarios internos). La vista de cliente por token NO toca
--  estas tablas. Reusa las funciones app_usuario_id() / app_es_gestor() /
--  app_cobrador_tiene_cliente() de 0002.
-- ─────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
--  MENSAJES (chat)
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists mensajes (
  id           uuid primary key default gen_random_uuid(),
  ambito       text not null check (ambito in ('general','cobrador')),
  cobrador_id  uuid references usuarios(id),
  autor_id     uuid not null references usuarios(id),
  cuerpo       text not null check (length(btrim(cuerpo)) between 1 and 2000),
  creado_en    timestamptz not null default now(),
  -- Integridad: el hilo de cobrador EXIGE cobrador_id; el general lo prohíbe.
  constraint mensajes_ambito_coherente
    check ((ambito = 'cobrador') = (cobrador_id is not null))
);

create index if not exists idx_mensajes_general
  on mensajes (creado_en) where ambito = 'general';
create index if not exists idx_mensajes_cobrador
  on mensajes (cobrador_id, creado_en) where ambito = 'cobrador';

alter table mensajes enable row level security;

drop policy if exists mensajes_select on mensajes;
drop policy if exists mensajes_insert on mensajes;
drop policy if exists mensajes_delete on mensajes;

-- Ver: el general lo ve todo interno; el hilo de cobrador, el gestor o el propio.
create policy mensajes_select on mensajes for select to authenticated
  using (
    ambito = 'general'
    or app_es_gestor()
    or cobrador_id = app_usuario_id()
  );

-- Escribir: el autor debe ser uno mismo y tener acceso a ese canal.
create policy mensajes_insert on mensajes for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and (
      ambito = 'general'
      or app_es_gestor()
      or cobrador_id = app_usuario_id()
    )
  );

-- Los mensajes no se editan; solo el admin puede borrar (moderación).
create policy mensajes_delete on mensajes for delete to authenticated
  using ( app_rol() = 'admin' );

-- ═════════════════════════════════════════════════════════════════════════
--  CHAT_LECTURAS (badge de no leídos): última lectura por usuario y canal.
--  `canal` = 'general' o 'cob:<uuid del cobrador>'.
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists chat_lecturas (
  usuario_id     uuid not null references usuarios(id),
  canal          text not null,
  ultima_lectura timestamptz not null default now(),
  primary key (usuario_id, canal)
);

alter table chat_lecturas enable row level security;

drop policy if exists chat_lecturas_todo on chat_lecturas;
create policy chat_lecturas_todo on chat_lecturas for all to authenticated
  using ( usuario_id = app_usuario_id() )
  with check ( usuario_id = app_usuario_id() );

-- ═════════════════════════════════════════════════════════════════════════
--  NOTAS_CLIENTE (equipo): notas por cliente, las ve quien ve al cliente.
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists notas_cliente (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  autor_id   uuid not null references usuarios(id),
  cuerpo     text not null check (length(btrim(cuerpo)) between 1 and 2000),
  creado_en  timestamptz not null default now()
);

create index if not exists idx_notas_cliente
  on notas_cliente (cliente_id, creado_en desc);

alter table notas_cliente enable row level security;

drop policy if exists notas_cliente_select on notas_cliente;
drop policy if exists notas_cliente_insert on notas_cliente;
drop policy if exists notas_cliente_delete on notas_cliente;

create policy notas_cliente_select on notas_cliente for select to authenticated
  using ( app_es_gestor() or app_cobrador_tiene_cliente(cliente_id) );
create policy notas_cliente_insert on notas_cliente for insert to authenticated
  with check (
    autor_id = app_usuario_id()
    and ( app_es_gestor() or app_cobrador_tiene_cliente(cliente_id) )
  );
-- Borra el autor o un gestor.
create policy notas_cliente_delete on notas_cliente for delete to authenticated
  using ( app_es_gestor() or autor_id = app_usuario_id() );

-- ═════════════════════════════════════════════════════════════════════════
--  NOTAS_PERSONALES: bloc privado de cada usuario.
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists notas_personales (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references usuarios(id),
  cuerpo         text not null check (length(btrim(cuerpo)) between 1 and 4000),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_notas_personales
  on notas_personales (usuario_id, creado_en desc);

alter table notas_personales enable row level security;

drop policy if exists notas_personales_todo on notas_personales;
create policy notas_personales_todo on notas_personales for all to authenticated
  using ( usuario_id = app_usuario_id() )
  with check ( usuario_id = app_usuario_id() );

drop trigger if exists trg_notas_personales_actualizado on notas_personales;
create trigger trg_notas_personales_actualizado
  before update on notas_personales
  for each row execute function set_actualizado_en();

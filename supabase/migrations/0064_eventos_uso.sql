-- ─────────────────────────────────────────────────────────────────────────
--  0064 · EVENTOS DE USO (telemetría de navegación por perfil).
--  Registra QUÉ sección abre cada usuario interno (staff con credenciales),
--  bajo qué rol y cuándo — para AUDITAR la capacitación: quién usa qué, quién
--  no entró nunca a Mora/Cobranza, etc. NO es el libro de auditoría de acciones
--  (tabla `auditoria`, que registra pagos/aprobaciones); esto es navegación.
--
--  Cada usuario inserta SU propio evento (RLS: usuario_id = app_usuario_id()).
--  Solo el ADMIN (dueño) lee el agregado. Append-only (sin update/delete).
--  Correr en el SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists eventos_uso (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references usuarios(id),
  usuario_nombre text,
  rol            text,
  path           text not null,
  seccion        text,
  creado_en      timestamptz not null default now()
);

create index if not exists idx_eventos_uso_usuario on eventos_uso (usuario_id, creado_en desc);
create index if not exists idx_eventos_uso_fecha on eventos_uso (creado_en desc);

alter table eventos_uso enable row level security;

-- Cada quien registra SU propio evento de navegación.
drop policy if exists eventos_uso_insert on eventos_uso;
create policy eventos_uso_insert on eventos_uso for insert to authenticated
  with check (usuario_id = app_usuario_id());

-- Solo el admin lee la telemetría (auditoría de capacitación del personal).
drop policy if exists eventos_uso_select on eventos_uso;
create policy eventos_uso_select on eventos_uso for select to authenticated
  using (app_es_admin());

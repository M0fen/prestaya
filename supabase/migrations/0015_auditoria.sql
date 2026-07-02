-- ─────────────────────────────────────────────────────────────────────────
--  0015 · AUDITORÍA (log inmutable de acciones sensibles).
--  Registra QUIÉN hizo QUÉ y CUÁNDO en el panel: renovaciones, movimientos de
--  caja, cierres de jornada, cambios de comisión/gaming, vaciado de chat, etc.
--  Inmutable: solo INSERT + SELECT (sin update/delete). Ejecutar en SQL Editor.
--  Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists auditoria (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references usuarios(id),
  actor_nombre text,                 -- snapshot del nombre (por si cambia luego)
  accion       text not null,        -- p. ej. "Renovó crédito"
  entidad      text,                 -- p. ej. "cliente" / "caja" / "cobrador"
  entidad_id   text,                 -- id de la entidad afectada
  detalle      text,                 -- descripción legible
  creado_en    timestamptz not null default now()
);

create index if not exists idx_auditoria_creado on auditoria (creado_en desc);

alter table auditoria enable row level security;

drop policy if exists audit_insert on auditoria;
drop policy if exists audit_select on auditoria;

-- Cada usuario registra SU propia acción (o vía service_role, que ignora RLS).
create policy audit_insert on auditoria for insert to authenticated
  with check ( actor_id = app_usuario_id() );
-- Solo gestores leen la auditoría.
create policy audit_select on auditoria for select to authenticated
  using ( app_es_gestor() );
-- Inmutable: NO se definen políticas de update ni delete.

-- ─────────────────────────────────────────────────────────────────────────
-- 0107 — REPORTE DE BUGS / INCIDENCIAS in-app.
--
-- Hasta hoy no había forma de que un usuario interno (admin/supervisor/cobrador)
-- registre un problema vivido en la app: se perdía en un WhatsApp suelto, sin
-- contexto ni seguimiento. Esta tabla + el botón "Reportar un problema" capturan
-- cada inconveniente con su contexto (rol, ruta, user-agent) para que el admin lo
-- triage (abierto → en progreso → resuelto). Complementa la captura AUTOMÁTICA de
-- errores (reportarError→Sentry): esto es la percepción HUMANA ("no cuadra", "no
-- hace nada"), que Sentry no ve.
--
-- No maneja dinero. Correr en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists incidencias (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references usuarios(id),
  usuario_nombre text,
  rol            text,
  ruta           text,          -- pathname donde se reportó
  user_agent     text,
  descripcion    text not null,
  categoria      text not null default 'otro'
                   check (categoria in ('bug','confuso','lento','dato_mal','sugerencia','otro')),
  estado         text not null default 'abierto'
                   check (estado in ('abierto','en_progreso','resuelto')),
  contexto       jsonb,         -- extra (último error, ids, etc.)
  creado_en      timestamptz not null default now(),
  resuelto_por   uuid references usuarios(id),
  resuelto_en    timestamptz,
  nota_resolucion text
);
create index if not exists idx_incidencias_estado on incidencias (estado);
create index if not exists idx_incidencias_creado on incidencias (creado_en desc);

alter table incidencias enable row level security;

-- Cada usuario REPORTA como sí mismo (no puede falsear el autor). VE las suyas; el
-- admin ve TODAS y las resuelve. Append por el usuario, triage solo admin. Sin delete.
drop policy if exists incidencias_insert on incidencias;
create policy incidencias_insert on incidencias for insert to authenticated
  with check ( usuario_id = app_usuario_id() );

drop policy if exists incidencias_select on incidencias;
create policy incidencias_select on incidencias for select to authenticated
  using ( app_es_admin() or usuario_id = app_usuario_id() );

drop policy if exists incidencias_update on incidencias;
create policy incidencias_update on incidencias for update to authenticated
  using ( app_es_admin() ) with check ( app_es_admin() );

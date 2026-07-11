-- ─────────────────────────────────────────────────────────────────────────
--  0057 — GASTOS DE RUTA CON APROBACIÓN DEL ADMIN.
--  Antes el cobrador cargaba un egreso directo en `movimientos_caja` (0017) y
--  esa plata salía de la caja al instante. Ahora el cobrador SOLICITA el gasto
--  ("necesito sacar para X"); SOLO el admin lo APRUEBA y recién ahí se crea el
--  egreso real. Espeja `solicitudes_anulacion` (0032).
--  Money-critical: un gasto cuenta como plata SOLO cuando está aprobado (el
--  egreso no existe hasta la aprobación) → ningún agregador de caja/rendición/
--  cuenta corriente ve un gasto pendiente. Cero fan-out de filtros.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists solicitudes_gasto (
  id                    uuid primary key default gen_random_uuid(),
  cobrador_id           uuid not null references usuarios(id),
  monto                 numeric(14,2) not null check (monto > 0),
  categoria             text,
  descripcion           text,
  estado                text not null default 'pendiente'
                          check (estado in ('pendiente','aprobada','rechazada')),
  solicitado_por        uuid references usuarios(id),
  solicitado_por_nombre text,
  solicitado_en         timestamptz not null default now(),
  resuelto_por          uuid references usuarios(id),
  resuelto_por_nombre   text,
  resuelto_en           timestamptz,
  motivo_rechazo        text
);

create index if not exists idx_solgasto_cobrador on solicitudes_gasto (cobrador_id, solicitado_en desc);
create index if not exists idx_solgasto_pendiente on solicitudes_gasto (estado) where estado = 'pendiente';

alter table solicitudes_gasto enable row level security;

-- El cobrador ve y crea SOLO las suyas.
drop policy if exists solgasto_cobrador_select on solicitudes_gasto;
create policy solgasto_cobrador_select on solicitudes_gasto for select
  using (cobrador_id = app_usuario_id());
drop policy if exists solgasto_cobrador_insert on solicitudes_gasto;
create policy solgasto_cobrador_insert on solicitudes_gasto for insert
  with check (cobrador_id = app_usuario_id() and solicitado_por = app_usuario_id());

-- El gestor (admin/supervisor) las ve todas. La aprobación real la hace el ADMIN
-- por service_role (no hay policy de UPDATE → nadie las edita vía RLS).
drop policy if exists solgasto_gestor_select on solicitudes_gasto;
create policy solgasto_gestor_select on solicitudes_gasto for select
  using (app_es_gestor());

-- Cerrar la fuga: el cobrador YA NO inserta egresos directos en la caja. Solo
-- puede SOLICITAR; el egreso lo crea el admin al aprobar (service_role bypassa RLS).
drop policy if exists mov_caja_insert_cobrador on movimientos_caja;

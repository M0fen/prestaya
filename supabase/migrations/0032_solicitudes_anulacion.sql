-- ─────────────────────────────────────────────────────────────────────────
--  0032 · SOLICITUDES de ANULACIÓN de pago (doble registro).
--  Ejecutar en el editor SQL de Supabase, DESPUÉS de 0031.
--
--  Decisión: el admin anula pagos DIRECTO; el supervisor SOLICITA y una
--  SEGUNDA persona (admin u otro gestor distinto al que pidió) CONFIRMA. La
--  anulación real del pago la ejecuta una Server Action con service_role tras
--  validar el doble registro (por RLS, anular pagos = solo admin).
--
--  El pago NO se borra jamás: se marca anulado con quién/cuándo/por qué
--  (constraint chk_pago_anulacion_completa de 0001). Esta tabla es el rastro
--  del pedido y su resolución.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists solicitudes_anulacion (
  id                    uuid primary key default gen_random_uuid(),
  pago_id               uuid not null references pagos(id),
  motivo                text not null,
  estado                text not null default 'pendiente'
                          check (estado in ('pendiente','confirmada','rechazada')),
  solicitado_por        uuid references usuarios(id),
  solicitado_por_nombre text,
  solicitado_en         timestamptz not null default now(),
  resuelto_por          uuid references usuarios(id),
  resuelto_por_nombre   text,
  resuelto_en           timestamptz,
  motivo_rechazo        text
);

-- Como mucho UNA solicitud pendiente por pago.
create unique index if not exists solanul_pendiente_unica
  on solicitudes_anulacion(pago_id) where (estado = 'pendiente');
create index if not exists solanul_estado
  on solicitudes_anulacion(estado, solicitado_en desc);

alter table solicitudes_anulacion enable row level security;

drop policy if exists solanul_select on solicitudes_anulacion;
drop policy if exists solanul_write on solicitudes_anulacion;

-- Los gestores ven las solicitudes y crean las suyas; la CONFIRMACIÓN (doble
-- registro) y la anulación efectiva del pago se controlan en la Server Action.
create policy solanul_select on solicitudes_anulacion for select to authenticated
  using ( app_es_gestor() );
create policy solanul_write on solicitudes_anulacion for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

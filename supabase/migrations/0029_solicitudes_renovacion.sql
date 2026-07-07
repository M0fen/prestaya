-- ─────────────────────────────────────────────────────────────────────────
--  0029 · SOLICITUDES de RENOVACIÓN (aprobación del admin).
--  El supervisor SOLICITA renovar; el ADMIN aprueba (crea el crédito) o rechaza.
--  El admin puede renovar directo (sin pasar por acá). Ejecutar en SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists solicitudes_renovacion (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  prestamo_anterior_id  uuid not null references prestamos(id),
  monto                 numeric(14,2) not null check (monto > 0),
  total_dias            int not null check (total_dias > 0),
  frecuencia            text not null,
  estado                text not null default 'pendiente'
                          check (estado in ('pendiente','aprobada','rechazada')),
  solicitado_por        uuid references usuarios(id),
  solicitado_por_nombre text,
  solicitado_en         timestamptz not null default now(),
  resuelto_por          uuid references usuarios(id),
  resuelto_en           timestamptz,
  motivo_rechazo        text,
  prestamo_nuevo_id     uuid references prestamos(id)
);

create index if not exists solren_estado on solicitudes_renovacion(estado, solicitado_en desc);
-- Como mucho UNA solicitud pendiente por crédito anterior.
create unique index if not exists solren_pendiente_unica
  on solicitudes_renovacion(prestamo_anterior_id) where (estado = 'pendiente');

alter table solicitudes_renovacion enable row level security;

drop policy if exists solren_select on solicitudes_renovacion;
drop policy if exists solren_write on solicitudes_renovacion;

-- Gestores ven y crean solicitudes; la aprobación/rechazo se restringe al admin
-- en la Server Action (aprobarSolicitud / rechazarSolicitud).
create policy solren_select on solicitudes_renovacion for select to authenticated
  using ( app_es_gestor() );
create policy solren_write on solicitudes_renovacion for all to authenticated
  using ( app_es_gestor() ) with check ( app_es_gestor() );

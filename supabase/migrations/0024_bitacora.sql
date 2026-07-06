-- ─────────────────────────────────────────────────────────────────────────
--  0024 · BITÁCORA DE CAMPO (auditoría hiper-blindada del cobrador).
--  Registra cada ACCIÓN del cobrador en la calle con GPS + hora del servidor
--  (autoritativa) + hora del dispositivo (para detectar reloj alterado).
--  Sirve para el score de sospecha (planchado, fuera de zona, sin moverse, GPS
--  apagado). INMUTABLE: solo INSERT + SELECT (sin update/delete) → nadie puede
--  borrar/editar su rastro. Ejecutar en el SQL Editor. Re-ejecutable.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists bitacora (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references usuarios(id),
  actor_nombre  text,                    -- snapshot del nombre
  rol           text,                    -- cobrador / supervisor / admin
  accion        text not null,           -- cobro / no_pago / censo / gasto / cierre_jornada / ver_ficha
  cliente_id    uuid,                    -- si aplica
  prestamo_id   uuid,
  monto         numeric,                 -- si aplica (cobro / gasto)
  detalle       text,
  gps_lat       numeric,
  gps_lng       numeric,
  gps_precision numeric,                 -- metros (si el dispositivo la da)
  gps_denegado  boolean not null default false,
  en_zona       boolean,                 -- para cobros: ¿estaba en la geo-cerca del cliente?
  device_ts     timestamptz,             -- hora del dispositivo (puede mentir)
  server_ts     timestamptz not null default now(),  -- hora AUTORITATIVA
  fecha_uy      date not null default ((now() at time zone 'America/Montevideo')::date)
);

create index if not exists idx_bitacora_actor_fecha on bitacora (actor_id, fecha_uy);
create index if not exists idx_bitacora_fecha on bitacora (fecha_uy desc);

alter table bitacora enable row level security;

drop policy if exists bitacora_insert on bitacora;
drop policy if exists bitacora_select on bitacora;

-- Cada usuario registra SU propia acción (o vía service_role, que ignora RLS).
create policy bitacora_insert on bitacora for insert to authenticated
  with check ( actor_id = app_usuario_id() );
-- Solo gestores leen la bitácora.
create policy bitacora_select on bitacora for select to authenticated
  using ( app_es_gestor() );
-- Inmutable: NO se definen políticas de update ni delete.

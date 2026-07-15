-- ─────────────────────────────────────────────────────────────────────────
--  LOG de RECONCILIACIÓN — cada corrida del cron deja un registro, para que
--  admin/dev vean el HISTORIAL ("¿cuadró la plata todos los días?") y la
--  tendencia, no solo la foto de hoy. Append-only (inmutable). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists reconciliacion_log (
  id            uuid primary key default gen_random_uuid(),
  corrida_en    timestamptz not null default now(),
  ok            boolean not null,
  total         int not null default 0,        -- diferencias totales
  criticos      int not null default 0,        -- hallazgos vivos (drift / sobre-cobro material activo)
  recaudo_libro numeric not null default 0,    -- recaudo del día según el libro de pagos
  origen        text not null default 'cron',  -- 'cron' | 'manual' | 'panel'
  detalle       jsonb                          -- por_invariante, etc.
);

create index if not exists idx_recon_log_fecha on reconciliacion_log (corrida_en desc);

alter table reconciliacion_log enable row level security;

-- LECTURA: cualquier usuario interno autenticado (el panel /admin/empalme lo lee).
drop policy if exists recon_log_select on reconciliacion_log;
create policy recon_log_select on reconciliacion_log for select to authenticated using (true);

-- ESCRITURA: solo el service_role (el cron / acción admin). Append-only: sin update/delete.
drop policy if exists recon_log_insert on reconciliacion_log;
create policy recon_log_insert on reconciliacion_log for insert to service_role with check (true);
